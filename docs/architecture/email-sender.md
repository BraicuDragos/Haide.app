# Email sender address

Status: a domain sender does **not** work yet. Nothing in the repo claims it does. Today every mail is sent
from the owner's Gmail address through Brevo.

## 1. Why mail arrives from `...@12885302.brevosend.com`

What is verified from the code:

- `.github/workflows/deploy.yml` sets `EMAIL_FROM` to `Haide <${EMAIL_FROM_ADDRESS}>`. Its default is the
  owner's Gmail address (the same value as `SUPPORT_EMAIL`).
- The Brevo provider sends that address as the `sender` of the API call.

What is Brevo's documented behaviour (confirm it in a raw message header, see below):

- `gmail.com` publishes a DMARC policy. Brevo cannot sign DKIM or align SPF for a domain it does not
  control, so for free-mail senders it sends through its shared `brevosend.com` domain.
- The recipient therefore sees a Gmail-looking address that is really on another domain. Mail clients and
  spam filters may flag or junk it. This is not a bug in Haide.

To confirm, open one received mail, "Show original" (Gmail) and check: `Return-Path` (expect a brevosend
domain), `DKIM-Signature: d=` (expect brevo or brevosend, not gmail.com) and `From`.

Auth mail (magic links) is a separate path: Supabase Auth sends through its own Brevo SMTP configuration
(the workflow only sets `admin_email` in `supabase/config.toml`). Those mails have the same sender problem
and must be changed in the Supabase SMTP settings when a domain sender is set up.

## 2. What is possible now

- Display name "Haide" (already set: `Haide <address>`).
- `Reply-To`: set `EMAIL_REPLY_TO` to an address the owner controls. The workflow sets it to `SUPPORT_EMAIL`,
  so a reply reaches the owner. The provider reads `EMAIL_REPLY_TO` and adds it as `replyTo`.
- The footer support line uses `RenderContext.supportEmail`. It is a placeholder (`support@haide.example`)
  until a real address exists.

This improves replies and the displayed name. It does not fix deliverability.

## 3. Moving to a domain sender later

1. Buy a domain.
2. Brevo: Senders, Domains & Dedicated IPs, Domains, Add a domain.
3. At the DNS provider (Cloudflare) add the records Brevo shows: the Brevo code TXT, the DKIM records
   (CNAME or TXT), and the SPF include (merge it into the one existing SPF TXT record, never two).
4. Add a DMARC TXT at `_dmarc`: `v=DMARC1; p=none; rua=mailto:<mailbox you read>`.
5. Click Verify in Brevo until the domain shows as authenticated.
6. Add the sender `no-reply@<domain>` in Brevo (Senders).
7. Set the GitHub repo variable `EMAIL_FROM_ADDRESS` to `no-reply@<domain>`. This is the single place
   that decides the address: the deploy workflow writes `EMAIL_FROM="Haide <${EMAIL_FROM_ADDRESS}>"`.
8. Re-run the deploy workflow.
9. Send a test mail and inspect the headers: expect `spf=pass`, `dkim=pass`, `dmarc=pass`.
10. Update the Supabase Auth SMTP sender to the same address.
11. After some weeks of clean reports, tighten DMARC (`p=quarantine`, later `p=reject`).
12. Replace the placeholder support and privacy addresses (`support@haide.example`, `privacy@haide.example`)
    in the email footer and the legal text with real ones on the domain.
