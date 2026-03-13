export interface FiasMessage {
  type: string;
  fields: Record<string, string>;
}

export interface FiasConn {
  send(content: string): void;
}