import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { ChevronDown, Clock, Mail, MapPin, Phone } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router';
import { z } from 'zod';
import { phoneSchema } from '../../components/store/AddressFields';
import { whatsappLink } from '../../components/store/Layout';
import { Button } from '../../components/ui/Button';
import { Alert } from '../../components/ui/Feedback';
import { Input, Textarea } from '../../components/ui/Field';
import { InstagramIcon, Sparkle, WhatsAppIcon } from '../../components/ui/Icons';
import { useDocumentTitle, useStoreSettings } from '../../hooks/useStore';
import { api, errorMessage } from '../../lib/api';
import { cn, formatPrice } from '../../lib/format';
import type { StoreSettings } from '../../lib/types';

function PageShell({ eyebrow, title, intro, children }: { eyebrow: string; title: string; intro?: ReactNode; children: ReactNode }) {
  useDocumentTitle(title);
  return (
    <div className="container-page pb-10 pt-10">
      <header className="mx-auto max-w-3xl text-center">
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="mt-2 text-[40px] sm:text-[54px]">{title}</h1>
        {intro && <p className="mt-3 text-ink-soft">{intro}</p>}
        <div className="gold-rule mx-auto mt-6 max-w-[200px]">
          <Sparkle className="size-3" />
        </div>
      </header>
      <div className="mx-auto mt-10 max-w-3xl">{children}</div>
    </div>
  );
}

const contactSchema = z.object({
  name: z.string().trim().min(2, 'Enter your name'),
  email: z.string().trim().email('Enter a valid email'),
  phone: z.union([z.literal(''), phoneSchema]).optional(),
  subject: z.string().trim().min(3, 'Add a short subject'),
  message: z.string().trim().min(10, 'Please write at least 10 characters').max(3000),
  website: z.string().optional(),
});

export function Contact() {
  const { data: s } = useStoreSettings();
  const form = useForm<z.input<typeof contactSchema>>({ resolver: zodResolver(contactSchema) });
  const send = useMutation({ mutationFn: (v: z.output<typeof contactSchema>) => api.post('/contact', { ...v, phone: v.phone || undefined }) });
  const c = s?.contact;
  const e = form.formState.errors;
  return (
    <PageShell eyebrow="We’re here to help" title="Contact us" intro="Questions about an order, sizing or a custom gift? Message us and we’ll get back within one business day.">
      <div className="grid gap-8 lg:grid-cols-[1fr_300px]">
        <div className="rounded-[24px] border border-line bg-paper p-6 shadow-soft sm:p-8">
          {send.isSuccess ? (
            <Alert tone="success" title="Message sent">
              Thank you! We’ll reply to {form.getValues('email')} soon.
            </Alert>
          ) : (
            <form noValidate className="grid gap-4 sm:grid-cols-2" onSubmit={form.handleSubmit((raw) => send.mutate(contactSchema.parse(raw)))}>
              {send.error && <Alert tone="danger" className="sm:col-span-2">{errorMessage(send.error)}</Alert>}
              <Input label="Name" required autoComplete="name" {...form.register('name')} error={e.name?.message} />
              <Input label="Email" type="email" required autoComplete="email" {...form.register('email')} error={e.email?.message} />
              <Input label="Mobile (optional)" type="tel" prefix="+91" {...form.register('phone')} error={e.phone?.message} />
              <Input label="Subject" required placeholder="Order AP-…, gift query…" {...form.register('subject')} error={e.subject?.message} />
              <Textarea wrapperClassName="sm:col-span-2" label="Message" required rows={5} {...form.register('message')} error={e.message?.message} />
              {/* Honeypot: hidden from people, tempting for bots */}
              <input type="text" tabIndex={-1} autoComplete="off" aria-hidden className="absolute -left-[9999px]" {...form.register('website')} />
              <div className="sm:col-span-2">
                <Button type="submit" loading={send.isPending}>
                  Send message
                </Button>
              </div>
            </form>
          )}
        </div>
        <aside className="space-y-4 text-sm">
          {c?.whatsapp && (
            <a href={whatsappLink(c.whatsapp)} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 rounded-2xl bg-[#1f9d55] p-4 font-medium text-white hover:brightness-95">
              <WhatsAppIcon className="size-6" /> Chat on WhatsApp
            </a>
          )}
          {c?.instagram && (
            <a href={c.instagram} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 rounded-2xl border border-line-strong bg-paper p-4 font-medium hover:border-rose-600">
              <InstagramIcon className="size-6 text-rose-600" /> Follow us on Instagram
            </a>
          )}
          <ul className="space-y-3 rounded-2xl border border-line bg-paper p-5 text-ink-soft">
            {c?.email && (
              <li className="flex gap-3">
                <Mail className="size-4 shrink-0 text-gold-500" />
                <a href={`mailto:${c.email}`} className="hover:text-rose-700">{c.email}</a>
              </li>
            )}
            {c?.phone && (
              <li className="flex gap-3">
                <Phone className="size-4 shrink-0 text-gold-500" /> {c.phone}
              </li>
            )}
            {c?.hours && (
              <li className="flex gap-3">
                <Clock className="size-4 shrink-0 text-gold-500" /> {c.hours}
              </li>
            )}
            {c?.address && (
              <li className="flex gap-3">
                <MapPin className="size-4 shrink-0 text-gold-500" /> {c.address}
              </li>
            )}
          </ul>
        </aside>
      </div>
    </PageShell>
  );
}

function faqs(s?: StoreSettings): { q: string; a: ReactNode }[] {
  const free = s?.shipping.freeShippingThreshold ? formatPrice(s.shipping.freeShippingThreshold) : null;
  return [
    { q: 'How long does delivery take?', a: `Most orders are delivered in ${s?.shipping.estimatedDays ?? 'a few business days'} after dispatch. You’ll get a tracking number as soon as your parcel ships.` },
    { q: 'How much is shipping?', a: free ? `Shipping is free on orders above ${free}. Below that, a flat ${formatPrice(s!.shipping.flatFee)} applies.` : `A flat ${formatPrice(s?.shipping.flatFee ?? 0)} shipping fee applies.` },
    { q: 'How can I pay?', a: 'All orders are prepaid. You can pay securely online with UPI, cards, net banking or wallets. We don’t offer Cash on Delivery.' },
    { q: 'Is online payment safe?', a: 'Payments are processed by Razorpay, a PCI-DSS compliant payment gateway. We never see or store your card or UPI details.' },
    { q: 'What is one-gram gold jewellery?', a: 'One-gram gold pieces are crafted from a base metal with a thin layer of real gold plating, giving the rich look of gold at a fraction of the price. Keep them away from water and perfume to keep the shine.' },
    { q: 'How do I track my order?', a: <>Use the secure tracking link in your confirmation email, or <Link to="/account/orders" className="text-rose-700 underline">sign in to your account</Link> to see all orders.</> },
    { q: 'Can I cancel my order?', a: 'You can cancel from your order page until we start processing it. After that, contact us and we’ll do our best to help.' },
    { q: 'Can I return or exchange an item?', a: <>We don’t accept returns or exchanges. If your piece arrives damaged or wrong, send us an unboxing video within 48 hours of delivery and we’ll replace it. See our <Link to="/refund-policy" className="text-rose-700 underline">refund policy</Link>.</> },
    { q: 'Are the jewellery pieces hypoallergenic?', a: 'Many of our earrings use nickel-free posts — check each product’s details. If you have sensitive skin, message us before ordering and we’ll recommend suitable pieces.' },
  ];
}

export function Faq() {
  const { data: s } = useStoreSettings();
  const [open, setOpen] = useState<number | null>(0);
  return (
    <PageShell eyebrow="Good to know" title="Frequently asked questions">
      <ul className="divide-y divide-line rounded-[24px] border border-line bg-paper px-5 shadow-soft sm:px-8">
        {faqs(s).map((f, i) => (
          <li key={f.q}>
            <button type="button" aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)} className="flex w-full items-center justify-between gap-4 py-5 text-left">
              <span className="font-display text-xl">{f.q}</span>
              <ChevronDown className={cn('size-5 shrink-0 text-muted transition-transform', open === i && 'rotate-180')} />
            </button>
            {open === i && <div className="animate-fade pb-5 text-ink-soft">{f.a}</div>}
          </li>
        ))}
      </ul>
      <p className="mt-8 text-center text-sm text-muted">
        Still have a question? <Link to="/contact" className="text-rose-700 underline underline-offset-2">Contact us</Link>.
      </p>
    </PageShell>
  );
}

export function ShippingPolicy() {
  const { data: s } = useStoreSettings();
  return (
    <PageShell eyebrow="Policies" title="Shipping policy">
      <article className="prose-ap rounded-[24px] border border-line bg-paper p-6 shadow-soft sm:p-10">
        <p>We ship across India from our studio. Every order is packed by hand and quality-checked before dispatch.</p>
        <h2>Delivery times</h2>
        <p>Orders are usually dispatched within 1–2 business days. Delivery typically takes {s?.shipping.estimatedDays ?? 'a few business days'} after dispatch, depending on your location. Remote areas may take longer.</p>
        <h2>Shipping charges</h2>
        <ul>
          {s?.shipping.freeShippingThreshold ? <li>Free shipping on orders of {formatPrice(s.shipping.freeShippingThreshold)} or more (after discounts).</li> : null}
          <li>A flat {formatPrice(s?.shipping.flatFee ?? 0)} applies to other orders.</li>
        </ul>
        <h2>Tracking</h2>
        <p>When your order ships we add the courier name and tracking number to your order page and email you. Tracking information shown on our site is updated by our team; for live scans use the courier’s tracking link.</p>
        <h2>Address issues</h2>
        <p>Please double-check your address and PIN code. If a parcel is returned because of an incorrect address or repeated failed delivery attempts, we’ll contact you to arrange re-shipping (additional charges may apply).</p>
      </article>
    </PageShell>
  );
}

export function ReturnsPolicy() {
  return (
    <PageShell eyebrow="Policies" title="Refund & cancellation policy">
      <article className="prose-ap rounded-[24px] border border-line bg-paper p-6 shadow-soft sm:p-10">
        <p>Every piece is quality-checked and packed by hand before it leaves our studio. Because of the nature of jewellery and accessories, <strong>we do not accept returns or exchanges</strong>.</p>
        <h2>Damaged or wrong items</h2>
        <p>If your order arrives damaged or you received the wrong item, message us within <strong>48 hours of delivery</strong> with a clear, uncut unboxing video. Once verified, we’ll send a replacement. If a replacement isn’t available, we’ll refund the item.</p>
        <h2>Cancellations</h2>
        <p>You can cancel your order from the order page until we start processing it. Once an order is packed or shipped it can’t be cancelled.</p>
        <h2>Refunds</h2>
        <ul>
          <li>Approved refunds go back to your original payment method through Razorpay. Banks usually take 5–7 business days to show it.</li>
          <li>Shipping fees are refunded only when an order is cancelled before dispatch or an item arrives damaged or wrong.</li>
        </ul>
        <p>Questions? <Link to="/contact">Contact us</Link> — we’re happy to help.</p>
      </article>
    </PageShell>
  );
}

export function PrivacyPolicy() {
  const { data: s } = useStoreSettings();
  return (
    <PageShell eyebrow="Policies" title="Privacy policy">
      <article className="prose-ap rounded-[24px] border border-line bg-paper p-6 shadow-soft sm:p-10">
        <p>This policy explains what personal information A&amp;P Creative Hub collects when you shop with us and how we use it.</p>
        <h2>What we collect</h2>
        <ul>
          <li>Contact details you provide: name, email address and mobile number.</li>
          <li>Delivery addresses and order history.</li>
          <li>Payment status and transaction references from our payment partner. We never receive or store card numbers, CVVs or UPI PINs.</li>
          <li>Messages you send through our contact form.</li>
        </ul>
        <h2>How we use it</h2>
        <ul>
          <li>To process, deliver and support your orders.</li>
          <li>To send order and shipping updates by email, and by WhatsApp only if you opt in.</li>
          <li>To prevent fraud and keep our store secure.</li>
        </ul>
        <h2>Sharing</h2>
        <p>We share only what is necessary with service providers who help us run the store: our payment gateway (Razorpay), courier partners (name, phone and address for delivery), our email provider and our hosting providers. We do not sell your data.</p>
        <h2>Cookies</h2>
        <p>We use essential cookies to keep you signed in and to protect forms against misuse. Your bag and wishlist are stored in your browser.</p>
        <h2>Your choices</h2>
        <p>You can update your profile and addresses in your account, opt out of WhatsApp updates, or ask us to delete your account{s?.contact.email ? <> by emailing <a href={`mailto:${s.contact.email}`}>{s.contact.email}</a></> : ' by contacting us'}. Some order records must be kept for legal and accounting purposes.</p>
      </article>
    </PageShell>
  );
}

export function Terms() {
  return (
    <PageShell eyebrow="Policies" title="Terms of service">
      <article className="prose-ap rounded-[24px] border border-line bg-paper p-6 shadow-soft sm:p-10">
        <p>By using this website and placing an order you agree to these terms.</p>
        <h2>Products</h2>
        <p>We photograph our pieces carefully, but colours may vary slightly between screens. Handmade and plated items can have small variations — this is part of their charm.</p>
        <h2>Prices and payment</h2>
        <p>All prices are in Indian Rupees and include applicable taxes. Prices and availability are confirmed when you place your order. All orders are prepaid, and an order is confirmed only after your online payment is verified. We don’t offer Cash on Delivery.</p>
        <h2>Order acceptance</h2>
        <p>We may cancel an order if an item becomes unavailable, if pricing was displayed in error, or if we suspect fraud. Any amount paid for a cancelled order is refunded in full.</p>
        <h2>Returns</h2>
        <p>We don’t accept returns or exchanges. Damaged or wrong items are replaced as described in our <Link to="/refund-policy">refund policy</Link>.</p>
        <h2>Coupons</h2>
        <p>Coupons are subject to their stated conditions (minimum order, validity, usage limits) and cannot be exchanged for cash.</p>
        <h2>Liability</h2>
        <p>Our liability for any order is limited to the amount paid for that order.</p>
        <h2>Governing law</h2>
        <p>These terms are governed by the laws of India.</p>
        <p>Questions? <Link to="/contact">Contact us</Link>.</p>
      </article>
    </PageShell>
  );
}
