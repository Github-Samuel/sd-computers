import type { ComponentType } from 'react';
import type { Win, WinApp } from '@/store/os';
import { isExt, type ExtAppId } from '@/types';
import Mail from './mail';
import EventViewer from './logs';
import CommandPrompt from './cmd';
import BusinessManager from './boss';
import Notepad from './notepad';
import Calculator from './calculator';
import Settings from './settings';
import Messages from './messages';
import Notes from './notes';
import Files from './files';
import Cameras from './cameras';
import Board from './board';
import Bank from './bank';
import Photos from './photos';
import Contacts from './contacts';
import PhoneLink from './phonelink';
import Browser from './browser';
import Games from './games';
import Mines from './games/Mines';
import Solitaire from './games/Solitaire';
import Snake from './games/Snake';
import HackWindow from './hack/HackWindow';
import ExtApp from './ext';

/** Props every app component receives: its own window (id, title, size, props...). */
export interface AppProps {
  win: Win;
}

/**
 * App id -> component. The ids are configs/shared/desktop.lua's Apps keys (plus 'hack', the
 * window Command Prompt spawns for a minigame, and the three games the Games shelf opens as
 * programs of their own). A new app needs an entry here AND in that config.
 * 'messages', 'notes' and 'contacts' only ever appear while the sd-phone link is live (the
 * server installs them, after 'phonelink' has linked the phone where it asks for that); 'boss',
 * 'board' and 'cameras' only for a player they are for.
 */
export const APPS: Record<Exclude<WinApp, ExtAppId>, ComponentType<AppProps>> = {
  mail: Mail,
  logs: EventViewer,
  cmd: CommandPrompt,
  boss: BusinessManager,
  notepad: Notepad,
  calculator: Calculator,
  settings: Settings,
  messages: Messages,
  notes: Notes,
  files: Files,
  cameras: Cameras,
  board: Board,
  bank: Bank,
  photos: Photos,
  contacts: Contacts,
  phonelink: PhoneLink,
  browser: Browser,
  games: Games,
  mines: Mines,
  solitaire: Solitaire,
  snake: Snake,
  hack: HackWindow,
};

/** The component a window draws: its app's, or - for a custom app another resource registered - the frame that holds its page. */
export const appFor = (app: WinApp): ComponentType<AppProps> => (isExt(app) ? ExtApp : APPS[app]);
