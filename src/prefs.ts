import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const PANEL_POSITION_KEY = 'panel-position';
const PANEL_INDEX_KEY = 'panel-index';
const PANEL_POSITIONS = ['left', 'center', 'right'] as const;

export default class MediaControlPreferences extends ExtensionPreferences {
  async fillPreferencesWindow(window: Adw.PreferencesWindow): Promise<void> {
    const settings = this.getSettings();

    const page = new Adw.PreferencesPage();
    const group = new Adw.PreferencesGroup({
      title: 'Panel',
    });

    const positionRow = new Adw.ComboRow({
      title: 'Panel position',
      subtitle: 'Which section of the top panel to use.',
      model: new Gtk.StringList({
        strings: ['Left', 'Center', 'Right'],
      }),
    });

    const setPositionRowFromSettings = () => {
      const index = PANEL_POSITIONS.indexOf(
        settings.get_string(PANEL_POSITION_KEY) as typeof PANEL_POSITIONS[number],
      );
      if (index >= 0)
        positionRow.selected = index;
    };

    setPositionRowFromSettings();
    positionRow.connect('notify::selected', () => {
      settings.set_string(PANEL_POSITION_KEY, PANEL_POSITIONS[positionRow.selected]);
    });
    settings.connect(`changed::${PANEL_POSITION_KEY}`, setPositionRowFromSettings);

    const indexRow = new Adw.SpinRow({
      title: 'Index in panel',
      subtitle: 'Order within the panel section (0 is leftmost).',
      adjustment: new Gtk.Adjustment({
        lower: 0,
        upper: 99,
        step_increment: 1,
      }),
    });

    settings.bind(
      PANEL_INDEX_KEY,
      indexRow,
      'value',
      Gio.SettingsBindFlags.DEFAULT,
    );

    group.add(positionRow);
    group.add(indexRow);
    page.add(group);
    window.add(page);
  }
}
