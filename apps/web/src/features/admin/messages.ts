import { registerMessages } from '@/i18n';
import admin from './admin.en.json';

// The admin copy ships with the lazy admin chunk, not the entry chunk (initial JS budget).
registerMessages(admin);
