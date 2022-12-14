const {
	Readable
} = require('stream');

const {
	Buffer
} = require('buffer');

/**
 * @typedef RequestProxyStreamConfig
 * @property {int} [maxStackedBuffers=25]
 */

/**
 * Translate a uWebSocket.js body data stream into a Readable stream, taking backpressure
 * into consideration.
 */
class RequestToProxyStream extends Readable{
	#res;
	#sendQueue = [];
	#shouldClose = false;
	#maxStackedBuffers = 25;

	/**
	 * Copy a buffer into another one without consuming the copied buffer.
	 * @param {Buffer} buffer
	 */
	static createBufferCopy(buffer){
		const copy = Buffer.alloc(buffer.byteLength);
		buffer.copy(copy);
		return copy;
	}

	/**
	 * @param res uWebSocket.js Response object. Request body is in there. Pretty counter-intuitive.
	 * @param {ReadableOptions & RequestProxyStreamConfig} config Stream config
	 * @see https://nodejs.org/api/stream.html#new-streamreadableoptions
	 */
	constructor(res, config = {}) {
		super(config);

		this.#res = res;
		this.#maxStackedBuffers = config.maxStackedBuffers || 25;

		// Immediately start to read data in res.
		res.onData((chunk, isLast) => {
			this.#trySendChunk(Buffer.from(chunk));

			if(isLast) this.#tryEnd();
		});
	}

	/**
	 * Copy a buffer into another one without consuming the copied buffer.
	 * @param {Buffer} buffer
	 */
	#createBufferCopy(buffer){
		return this.constructor.createBufferCopy(buffer);
	}

	/**
	 * Try to send a chunk and buffer it if we encounter backpressure.
	 * @param {Buffer} buffer
	 */
	#trySendChunk(buffer){
		if(buffer.byteLength === 0) {
			this.#tryEnd();
			return true;
		}

		if(!this.push(this.#createBufferCopy(buffer))){
			if(this.#sendQueue.length === this.#maxStackedBuffers){
				this.destroy(new Error(
					'Max backpressure threshold reached !'
				));
				return false;
			} else {
				this.#sendQueue.push(buffer);
				return false;
			}
		}

		return true;
	}

	/**
	 * Try to end the current stream. Will abort if the sending queue is not empty.
	 */
	#tryEnd(){
		this.#shouldClose = true;
		if(this.#sendQueue.length === 0) this.#close();
	}

	/**
	 * End the stream then destroy it.
	 */
	#close(){
		this.push(null);
		this.destroy();
	}

	_read(n){
		// Sending as many data as we can to empty the sendQueue filled by backpressure.
		while (this.#sendQueue.length > 0 && this.#trySendChunk(this.#sendQueue[0])){
			this.#sendQueue.splice(0, 1);
		}

		if(this.#shouldClose && this.#sendQueue.length === 0) this.#close();
	}

	_destroy(error, callback) {
		this.#sendQueue = [];
		callback(error);
	}
}

module.exports = RequestToProxyStream;