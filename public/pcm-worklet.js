/**
 * AudioWorkletProcessor that buffers mono PCM samples into 1024-sample chunks
 * and posts them to the main thread to minimize message overhead.
 */
class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunkSize = 1024;
    this.buffer = new Float32Array(this.chunkSize);
    this.offset = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) {
      return true;
    }

    const channel = input[0];
    if (!channel || channel.length === 0) {
      return true;
    }

    let readIndex = 0;
    while (readIndex < channel.length) {
      const remainingSpace = this.chunkSize - this.offset;
      const toCopy = Math.min(remainingSpace, channel.length - readIndex);
      this.buffer.set(
        channel.subarray(readIndex, readIndex + toCopy),
        this.offset,
      );
      this.offset += toCopy;
      readIndex += toCopy;

      if (this.offset >= this.chunkSize) {
        const completed = this.buffer;
        this.port.postMessage(completed, [completed.buffer]);
        this.buffer = new Float32Array(this.chunkSize);
        this.offset = 0;
      }
    }

    return true;
  }
}

registerProcessor('pcm-capture-processor', PcmCaptureProcessor);
