export interface SseEvent {
  event: string;
  data: string;
}

/**
 * Parser mínimo de Server-Sent Events para usar con `fetch` (EventSource no permite enviar la
 * cabecera Authorization). Acepta el texto en trozos arbitrarios: un evento puede llegar partido
 * entre dos lecturas, o varios en una sola.
 */
export class SseParser {
  private buffer = '';
  private event = '';
  private data: string[] = [];

  /** Agrega texto y devuelve los eventos que quedaron completos. */
  push(text: string): SseEvent[] {
    this.buffer += text;
    const out: SseEvent[] = [];
    let newline: number;
    while ((newline = this.buffer.search(/\r\n|\r|\n/)) >= 0) {
      const line = this.buffer.slice(0, newline);
      const width = this.buffer.startsWith('\r\n', newline) ? 2 : 1;
      // Un "\r" al final del búfer puede ser la mitad de un "\r\n": se espera al siguiente trozo.
      if (width === 1 && this.buffer[newline] === '\r' && newline === this.buffer.length - 1) break;
      this.buffer = this.buffer.slice(newline + width);
      const event = this.line(line);
      if (event) out.push(event);
    }
    return out;
  }

  private line(line: string): SseEvent | null {
    if (line === '') {
      const event =
        this.data.length > 0 ? { event: this.event || 'message', data: this.data.join('\n') } : null;
      this.event = '';
      this.data = [];
      return event;
    }
    if (line.startsWith(':')) return null; // comentario
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') this.event = value;
    else if (field === 'data') this.data.push(value);
    return null;
  }
}
