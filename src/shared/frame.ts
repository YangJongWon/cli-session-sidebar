const MAX_FRAME = 8_000_000;

export function encodeFrame(message: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  if (body.length > MAX_FRAME) {
    throw new Error('메시지가 너무 큽니다.');
  }
  const header = Buffer.alloc(4);
  header.writeUInt32BE(body.length, 0);
  return Buffer.concat([header, body]);
}

export class FrameParser {
  private buffer = Buffer.alloc(0);

  push(chunk: Buffer, onMessage: (message: unknown) => void): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 4) {
      const length = this.buffer.readUInt32BE(0);
      if (length > MAX_FRAME) {
        throw new Error('잘못된 프레임입니다.');
      }
      if (this.buffer.length < 4 + length) {
        return;
      }
      const json = this.buffer.subarray(4, 4 + length).toString('utf8');
      this.buffer = this.buffer.subarray(4 + length);
      onMessage(JSON.parse(json) as unknown);
    }
  }
}
