import Adw from 'gi://Adw';
import Gio from 'gi://Gio';

import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const SHOW_NOTIFICATIONS_KEY = 'show-notifications';

export default class MediaControlPreferences extends ExtensionPreferences {
  async fillPreferencesWindow(window: Adw.PreferencesWindow): Promise<void> {
    const settings = this.getSettings();

    const page = new Adw.PreferencesPage();
    const group = new Adw.PreferencesGroup({
      title: 'General',
    });

    const showNotificationsRow = new Adw.SwitchRow({
      title: 'Show notifications',
      subtitle: 'Notify when the extension is enabled.',
    });

    settings.bind(
      SHOW_NOTIFICATIONS_KEY,
      showNotificationsRow,
      'active',
      Gio.SettingsBindFlags.DEFAULT,
    );

    group.add(showNotificationsRow);
    page.add(group);
    window.add(page);
  }
}
