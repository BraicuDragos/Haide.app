import { Link } from 'react-router';
import { useScreenHeading } from '@/app/useScreenHeading';
import { useSignOut } from '@/auth/hooks';
import { t } from '@/i18n';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';

/** 5.7: the account is paused. Plain words, one way out (Sign out), and public browsing stays one tap away. */
export default function SuspendedScreen() {
  const h1 = useScreenHeading(t('suspended.title'));
  const signOut = useSignOut();
  return (
    <div className="empty py-16">
      <Icon name="shield" className="size-12 text-text-muted" />
      <h1 ref={h1} tabIndex={-1} className="type-h2">
        {t('suspended.title')}
      </h1>
      <p role="alert" className="max-w-[32ch] text-text-muted">
        {t('error.suspended')}
      </p>
      <Button variant="secondary" onClick={() => void signOut()}>
        {t('me.signOut')}
      </Button>
      <Link to="/find" className="btn btn-ghost">
        {t('find.title')}
      </Link>
      <Link to="/delete" className="btn btn-ghost">
        {t('settings.delete')}
      </Link>
    </div>
  );
}
