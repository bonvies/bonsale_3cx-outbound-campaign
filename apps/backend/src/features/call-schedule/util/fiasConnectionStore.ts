import { FiasConn } from '../types/fias/fiasTypes';

let _conn: FiasConn | null = null;

export const setFiasConn = (conn: FiasConn | null): void => { _conn = conn; };
export const getFiasConn = (): FiasConn | null => _conn;
