import type { RpcResult } from '@/types';
import shell from './shell';
import mail from './mail';
import logs from './logs';
import cmd from './cmd';
import boss from './boss';
import notes from './notes';
import messages from './messages';
import phonenotes from './phonenotes';
import files from './files';
import cameras from './cameras';
import board from './board';
import bank from './bank';
import photos from './photos';
import contacts from './contacts';
import phonelink from './phonelink';
import browser from './browser';
import web from './web';
import print from './print';
import ext from './ext';

/** A mock handler: gets the rpc payload, returns what the server's handler would. */
export type MockHandler = (payload: Record<string, unknown>) => RpcResult<unknown> | Promise<RpcResult<unknown>>;

// One file per app so the mocks grow next to the app they serve. Keys are rpc endpoint names
// exactly as registered in server/computers/*.lua.
const handlers: Record<string, MockHandler> = {
  ...shell, ...mail, ...logs, ...cmd, ...boss, ...notes, ...messages, ...phonenotes,
  ...files, ...cameras, ...board, ...bank, ...photos, ...contacts, ...phonelink, ...browser, ...web, ...print, ...ext,
};

/** Browser-only stand-in for the server: a short fake latency, then the mock handler's reply. */
export async function mockRpc<T>(endpoint: string, payload: Record<string, unknown>): Promise<RpcResult<T>> {
  await new Promise(r => setTimeout(r, 120 + Math.random() * 180));
  const h = handlers[endpoint];
  if (!h) {
    console.warn(`[mock] no handler for ${endpoint}`, payload);
    return { ok: false, error: `mock: no handler for ${endpoint}` };
  }
  return (await h(payload)) as RpcResult<T>;
}

export const ok = <T>(data?: T): RpcResult<T> => ({ ok: true, data });
export const fail = (error: string): RpcResult<never> => ({ ok: false, error });
