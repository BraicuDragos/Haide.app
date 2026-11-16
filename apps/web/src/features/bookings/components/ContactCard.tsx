import type { BookingView } from '@/api/types';
import { t } from '@/i18n';
import { telHref, whatsappHref, whenLabel } from '@/lib/booking';
import { Icon } from '@/ui/Icon';

/**
 * Counterpart contact (4.2): Call and WhatsApp, only while the server sends `contact` (confirmed, before departure + 24 h).
 * The links are plain anchors so they work without script and are real links for assistive tech.
 */
export function ContactCard({ booking }: { booking: BookingView }) {
  const c = booking.contact;
  if (!c) return null;
  const driver = booking.driver.firstName ?? '';
  return (
    <section aria-labelledby="bk-contact" className="card flex flex-col gap-3 p-4">
      <h2 id="bk-contact" className="type-h3">
        {t('booking.contact', { driver })}
      </h2>
      <div className="grid grid-cols-2 gap-3">
        <a
          href={telHref(c.phoneE164)}
          aria-label={t('booking.callTo', { driver })}
          className="btn btn-tonal"
        >
          <Icon name="phone" />
          {t('booking.call')}
        </a>
        <a
          href={whatsappHref(c.phoneE164)}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={t('booking.whatsappTo', { driver })}
          className="btn btn-tonal"
        >
          <Icon name="chat" />
          {t('booking.whatsapp')}
        </a>
      </div>
      <p className="text-sm leading-5 text-text-muted">
        {t('booking.visibleUntil', { when: whenLabel(c.revealedUntil) })}
        {'. '}
        {t('booking.hiddenAfter')}
      </p>
    </section>
  );
}
