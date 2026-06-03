import type Gio from 'gi://Gio';

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { MediaIndicator } from './mediaIndicator.js';

const PANEL_POSITION_KEY = 'panel-position';
const PANEL_INDEX_KEY = 'panel-index';
const STATUS_AREA_ROLE = 'now-playing';

export default class MediaControlExtension extends Extension {
  private _settings: Gio.Settings | null = null;
  private _indicator: InstanceType<typeof MediaIndicator> | null = null;
  private _settingsChangedIds: number[] = [];

  enable() {
    this._settings = this.getSettings();
    this._addIndicator();

    this._settingsChangedIds.push(
      this._settings.connect(`changed::${PANEL_POSITION_KEY}`, () => this._repositionIndicator()),
      this._settings.connect(`changed::${PANEL_INDEX_KEY}`, () => this._repositionIndicator()),
    );
  }

  disable() {
    for (const id of this._settingsChangedIds) this._settings?.disconnect(id);
    this._settingsChangedIds = [];

    this._indicator?.destroy();
    this._indicator = null;
    this._settings = null;
  }

  private _addIndicator() {
    if (!this._settings) return;

    this._indicator = new MediaIndicator();
    this._indicator.bindSettings(this._settings);
    const index = this._settings.get_int(PANEL_INDEX_KEY);
    const position = this._settings.get_string(PANEL_POSITION_KEY);
    Main.panel.addToStatusArea(STATUS_AREA_ROLE, this._indicator, index, position);
  }

  private _repositionIndicator() {
    if (!this._settings || !this._indicator) return;

    this._indicator.destroy();
    this._indicator = null;
    this._addIndicator();
  }
}
