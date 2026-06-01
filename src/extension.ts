import type Gio from 'gi://Gio';

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { MediaIndicator } from './mediaIndicator.js';

export default class MediaControlExtension extends Extension {
  private _settings: Gio.Settings | null = null;
  private _indicator: InstanceType<typeof MediaIndicator> | null = null;

  enable() {
    this._settings = this.getSettings();

    this._indicator = new MediaIndicator();
    Main.panel.addToStatusArea('now-playing', this._indicator);
  }

  disable() {
    this._indicator?.destroy();
    this._indicator = null;
    this._settings = null;
  }
}
