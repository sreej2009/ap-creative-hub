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
import { STORE_DETAILS, storeContact } from '../../lib/constants';
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
  // Fall back to the business details so contact info is never blank.
  const c = s ? { ...s.contact, ...storeContact(s.contact) } : undefined;
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
    { q: 'How long does delivery take?', a: `Orders are ready to ship within 1–2 working days. Delivery usually takes ${s?.shipping.estimatedDays ?? 'a few business days'} after dispatch, depending on your location. You’ll get a tracking number as soon as your parcel ships.` },
    { q: 'How much is shipping?', a: free ? `Shipping is free on orders above ${free}. Below that, a flat ${formatPrice(s!.shipping.flatFee)} applies.` : `A flat ${formatPrice(s?.shipping.flatFee ?? 0)} shipping fee applies.` },
    { q: 'Do you offer Cash on Delivery?', a: 'No. All orders are paid in advance online, using UPI, debit or credit cards, net banking or other methods shown at checkout.' },
    { q: 'Is online payment safe?', a: 'Payments are handled by a secure third-party payment gateway. We never see or store your full card details, and we will never ask for your OTP, UPI PIN or passwords.' },
    { q: 'Can I cancel my order?', a: <>We don’t accept cancellations once an order is paid, so please check your order carefully before paying. See our <Link to="/refund-policy" className="text-rose-700 underline">refund &amp; cancellation policy</Link>.</> },
    { q: 'Can I return or exchange an item?', a: <>We don’t accept returns or exchanges. If you receive a damaged or defective product, contact us with your order details and an unboxing video. Claims without an unboxing video can’t be accepted. See our <Link to="/shipping" className="text-rose-700 underline">shipping &amp; returns policy</Link>.</> },
    { q: 'How do I track my order?', a: <>Use the secure tracking link in your confirmation email, or <Link to="/account/orders" className="text-rose-700 underline">sign in to your account</Link> to see all your orders.</> },
    { q: 'Do you take wholesale orders?', a: <>Yes! We welcome bulk and wholesale enquiries. <Link to="/contact" className="text-rose-700 underline">Get in touch</Link> or call us on {storeContact(s?.contact).phone}.</> },
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

/* ------------------------------- About -------------------------------- */

const WHY_US = [
  { icon: '🎀', title: '900+ collections', text: 'Explore a wide variety of beautiful and trendy products.' },
  { icon: '💗', title: 'Pinterest-inspired designs', text: 'Discover unique styles that make you stand out.' },
  { icon: '✨', title: 'Imported collections', text: 'Enjoy fashionable and eye-catching products.' },
  { icon: '🛍️', title: 'Something for everyone', text: 'Hair accessories, stationery, bags and more!' },
  { icon: '💝', title: 'Customer happiness first', text: 'Your love and satisfaction inspire us every day.' },
];

export function About() {
  const { data: s } = useStoreSettings();
  const c = storeContact(s?.contact);
  return (
    <PageShell eyebrow="Our story" title="About us" intro="Your happy place for trendy accessories, stationery & more! ✨">
      <article className="prose-ap rounded-[24px] border border-line bg-paper p-6 text-center shadow-soft sm:p-10">
        <p className="font-display text-2xl text-ink">Welcome to A&amp;P Creative Hub! 💖</p>
        <p>
          At <strong>A&amp;P Creative Hub</strong>, we believe that little things can make a big difference! From stylish hair accessories to trendy stationery and
          beautiful bags, we bring you collections that add charm, creativity and happiness to your everyday life.
        </p>
        <p>
          With <strong>900+ unique collections</strong>, we offer a beautiful range of Pinterest-inspired, trendy and imported products, carefully selected to match your
          style, mood and every occasion.
        </p>
        <p>
          Whether you’re looking for cute everyday essentials, elegant hair accessories, fashionable bags or creative stationery, you’ll find something special at
          A&amp;P Creative Hub.
        </p>
      </article>

      <section className="mt-12" aria-labelledby="why-us">
        <h2 id="why-us" className="text-center text-[32px] sm:text-[38px]">
          🌸 Why choose A&amp;P Creative Hub?
        </h2>
        <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {WHY_US.map((w) => (
            <li key={w.title} className="rounded-[20px] border border-line bg-paper p-5 text-center shadow-soft">
              <span className="text-3xl" aria-hidden>
                {w.icon}
              </span>
              <p className="mt-2 font-display text-xl">{w.title}</p>
              <p className="mt-1 text-sm text-ink-soft">{w.text}</p>
            </li>
          ))}
        </ul>
      </section>

      <div className="mt-12 grid gap-4 sm:grid-cols-2">
        <section className="rounded-[20px] border border-gold-300/60 bg-blush-50 p-6" aria-labelledby="refund-note">
          <h2 id="refund-note" className="text-2xl">
            📦 Important note: refunds
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-ink-soft">
            An unboxing video is mandatory for refund claims. Please record a clear, continuous and uninterrupted video while opening your package. Refund
            eligibility is subject to our <Link to="/refund-policy" className="text-rose-700 underline underline-offset-2">Refund Policy</Link> and applicable consumer
            rights.
          </p>
        </section>
        <section className="rounded-[20px] border border-line bg-paper p-6 shadow-soft" aria-labelledby="wholesale">
          <h2 id="wholesale" className="text-2xl">
            💼 Wholesale enquiries
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-ink-soft">Looking to purchase our products in bulk? We welcome wholesale enquiries! Get in touch with us for more details.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <a href={`tel:${c.phone.replace(/\s/g, '')}`} className="inline-flex items-center gap-2 rounded-full border border-line-strong px-4 py-2 text-sm font-medium hover:border-rose-600 hover:text-rose-700">
              <Phone className="size-4" /> {c.phone}
            </a>
            <a href={whatsappLink(c.whatsapp, 'Hi A&P Creative Hub! I have a wholesale enquiry.')} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-full bg-[#1f9d55] px-4 py-2 text-sm font-medium text-white hover:brightness-95">
              <WhatsAppIcon className="size-4" /> WhatsApp
            </a>
          </div>
        </section>
      </div>

      <section className="mt-12 text-center">
        <h2 className="text-[30px]">Thank you for choosing A&amp;P Creative Hub! 🌷</h2>
        <p className="mx-auto mt-3 max-w-xl text-ink-soft">Every order means a lot to us! Thank you for supporting our small business and being a part of our journey.</p>
        <p className="mt-5 font-display text-2xl italic text-rose-700">Shop More. Smile More. Shine More! 💖</p>
        <p className="mt-4 text-sm text-muted">
          With love,
          <br />
          <span className="font-medium text-ink">Team A&amp;P Creative Hub</span>
        </p>
      </section>
    </PageShell>
  );
}

/* ------------------------------ Policies ------------------------------ */

function PolicyCard({ children }: { children: ReactNode }) {
  return <article className="prose-ap rounded-[24px] border border-line bg-paper p-6 shadow-soft sm:p-10">{children}</article>;
}

function Updated() {
  return <p className="text-sm text-muted">Last updated: {STORE_DETAILS.policiesUpdated}</p>;
}

function ContactBlock() {
  const { data: s } = useStoreSettings();
  const c = storeContact(s?.contact);
  return (
    <ul className="!list-none !pl-0">
      <li>
        <strong>Email:</strong> <a href={`mailto:${c.email}`}>{c.email}</a>
      </li>
      <li>
        <strong>Phone:</strong> <a href={`tel:${c.phone.replace(/\s/g, '')}`}>{c.phone}</a>
      </li>
      <li>
        <strong>Location:</strong> {c.address}
      </li>
    </ul>
  );
}

export function ShippingPolicy() {
  const { data: s } = useStoreSettings();
  return (
    <PageShell eyebrow="Policies" title="Shipping & returns">
      <PolicyCard>
        <Updated />
        <h2>Shipping policy</h2>
        <ul>
          <li>
            <strong>Processing time:</strong> Your order will be ready to ship within 1–2 working days of placing your order.
          </li>
          <li>
            <strong>Delivery time:</strong> Shipping times may vary based on location, but we aim to get your order to you as quickly as possible once it has been
            processed{s?.shipping.estimatedDays ? ` — usually ${s.shipping.estimatedDays} after dispatch` : ''}.
          </li>
          <li>
            <strong>Shipping regions:</strong> We currently ship across India.
          </li>
          <li>
            <strong>Shipping charges:</strong>{' '}
            {s?.shipping.freeShippingThreshold
              ? `Free shipping on orders of ${formatPrice(s.shipping.freeShippingThreshold)} or more; a flat ${formatPrice(s.shipping.flatFee)} applies to other orders.`
              : `A flat ${formatPrice(s?.shipping.flatFee ?? 0)} applies to each order.`}{' '}
            Charges are always shown at checkout before you pay.
          </li>
        </ul>
        <h2>Payment policy</h2>
        <p>
          <strong>No Cash on Delivery (COD):</strong> We do not offer COD as a payment option. All orders must be paid for in advance through the available online
          payment methods.
        </p>
        <h2>Cancellation and return policy</h2>
        <p>
          <strong>No cancellations or returns:</strong> We do not accept cancellations, returns or exchanges. Please review your order carefully before completing your
          purchase.
        </p>
        <h2>Claims for damaged or defective products</h2>
        <p>
          <strong>Unboxing video required for claims:</strong> In the rare event that you receive a damaged or defective product, please record an unboxing video. This
          video will be required for any claim related to product damage. Claims without an unboxing video will not be accepted.
        </p>
        <h2>Tracking</h2>
        <p>When your order ships, we add the courier name and tracking number to your order page and email you.</p>
        <h2>Customer support</h2>
        <p>For any queries or concerns, feel free to contact our customer support team. We are here to assist you and ensure a smooth shopping experience.</p>
        <ContactBlock />
      </PolicyCard>
    </PageShell>
  );
}

export function ReturnsPolicy() {
  return (
    <PageShell eyebrow="Policies" title="Refund & cancellation policy">
      <PolicyCard>
        <Updated />
        <h2>No cancellations, returns or exchanges</h2>
        <p>We do not accept cancellations, returns or exchanges. Please review your order carefully before completing your purchase.</p>
        <h2>Damaged, defective, incorrect or missing products</h2>
        <p>If you receive a damaged, defective, incorrect or missing product, please contact us with your order number and supporting evidence.</p>
        <ul>
          <li>
            <strong>An unboxing video is mandatory</strong> for refund claims. Please record a clear, continuous and uninterrupted video while opening your package.
          </li>
          <li>Claims without an unboxing video will not be accepted.</li>
        </ul>
        <h2>Refunds</h2>
        <ul>
          <li>Eligible refunds are made to your original payment method once your claim is verified. Your bank may take a few business days to show it.</li>
          <li>If we have to cancel an order after payment (for example, if an item becomes unavailable), the amount paid is refunded to your original payment method.</li>
        </ul>
        <p>This policy does not remove or restrict any mandatory consumer rights or remedies available to you under applicable Indian law.</p>
        <h2>Contact us</h2>
        <ContactBlock />
      </PolicyCard>
    </PageShell>
  );
}

export function PrivacyPolicy() {
  const gw = STORE_DETAILS.paymentGateway;
  return (
    <PageShell eyebrow="Policies" title="Privacy policy">
      <PolicyCard>
        <Updated />
        <p>
          We value your privacy and are committed to protecting your personal information. This Privacy Policy explains how A&amp;P Creative Hub collects, uses,
          stores and protects your information when you visit our website, browse our products or make a purchase.
        </p>
        <p>By using our website, you agree to the practices described in this Privacy Policy, subject to applicable laws.</p>

        <h2>1. Personal information we collect</h2>
        <p>When you place an order or interact with our website, we may collect the following information:</p>
        <ul>
          <li>Full name</li>
          <li>Email address</li>
          <li>Mobile number</li>
          <li>Shipping and billing address</li>
          <li>Order and purchase details</li>
          <li>Payment transaction details</li>
        </ul>
        <p>We use this information to process orders, arrange deliveries, provide customer support and keep you updated about your purchases.</p>
        <p>We do not sell your personal information to third parties.</p>

        <h2>2. Browsing information</h2>
        <p>When you visit our website, certain technical information may be collected automatically, including:</p>
        <ul>
          <li>IP address</li>
          <li>Browser type</li>
          <li>Device information</li>
          <li>Operating system</li>
          <li>Website browsing activity</li>
        </ul>
        <p>This information helps us improve our website, understand customer preferences, maintain security and provide a better shopping experience.</p>
        <p>We may also use cookies or similar technologies where applicable.</p>

        <h2>3. Payment information</h2>
        <p>We provide secure online payment facilities through our third-party payment gateway, {gw}.</p>
        <p>We do not directly collect or store your complete credit or debit card details on our servers.</p>
        <p>Payment information is processed securely by {gw} according to its applicable security standards and privacy policies.</p>
        <p>We may retain limited transaction details, such as payment status, transaction ID and order amount, for order processing, refunds, accounting and legal compliance.</p>

        <h2>4. Data security</h2>
        <p>Protecting our customers’ personal information is important to us.</p>
        <p>We take reasonable technical and organisational measures to protect your information against unauthorised access, misuse, loss, alteration or disclosure.</p>
        <p>Our security practices may include:</p>
        <ul>
          <li>SSL/TLS encryption for secure data transmission</li>
          <li>Secure payment processing through trusted payment providers</li>
          <li>Restricted access to customer information</li>
          <li>Appropriate technical and administrative safeguards</li>
        </ul>
        <p>However, no online transmission or storage method can guarantee complete security.</p>

        <h2>5. Consent</h2>
        <p>
          By providing your personal information while placing an order, completing a payment, requesting support or contacting us, you agree to its use for the
          relevant purposes described in this policy, subject to applicable laws.
        </p>
        <p>Where additional consent is required, we will obtain it appropriately.</p>
        <p>If we use your information for promotional emails, offers or marketing communications, we will provide an appropriate consent or opt-out mechanism as required by law.</p>
        <p>You may withdraw consent for consent-based processing by contacting us, subject to applicable legal requirements.</p>

        <h2>6. Sharing information with third parties</h2>
        <p>We may share necessary customer information with trusted service providers to operate our online store and fulfil your orders. These may include:</p>
        <ul>
          <li>Payment gateway providers such as {gw}</li>
          <li>Courier and delivery partners</li>
          <li>Website hosting providers</li>
          <li>Technical support providers</li>
          <li>Customer service providers</li>
        </ul>
        <p>We share only the information reasonably necessary to provide these services.</p>
        <p>We do not sell or rent your personal information to third parties for their independent marketing purposes.</p>

        <h2>7. Your privacy rights</h2>
        <p>Subject to applicable laws, you may have the right to:</p>
        <ul>
          <li>Request access to your personal information</li>
          <li>Request correction of inaccurate information</li>
          <li>Request deletion of your personal information</li>
          <li>Withdraw consent where applicable</li>
          <li>Raise questions or complaints about how your information is handled</li>
        </ul>
        <p>To exercise your applicable rights, please contact A&amp;P Creative Hub using the details below.</p>
        <p>Certain information may need to be retained for legal, accounting, security or regulatory purposes.</p>

        <h2>8. Data retention</h2>
        <p>We retain your personal information only for as long as reasonably necessary to:</p>
        <ul>
          <li>Process and fulfil your orders</li>
          <li>Provide customer support</li>
          <li>Maintain purchase and transaction records</li>
          <li>Resolve disputes</li>
          <li>Meet legal and regulatory requirements</li>
        </ul>
        <p>When your information is no longer required, we take appropriate steps to delete or securely dispose of it, subject to applicable retention requirements.</p>

        <h2>9. {gw} payment gateway</h2>
        <p>A&amp;P Creative Hub uses {gw} as a third-party payment gateway to facilitate online payments.</p>
        <p>When you make a payment through our website, your payment information is processed by {gw} in accordance with its applicable privacy policy and security practices.</p>
        <p>We recommend reviewing {gw}’s privacy policy for more information about how payment information is handled.</p>

        <h2>Contact us</h2>
        <ContactBlock />
      </PolicyCard>
    </PageShell>
  );
}

export function Terms() {
  const gw = STORE_DETAILS.paymentGateway;
  return (
    <PageShell eyebrow="Policies" title="Terms & conditions">
      <PolicyCard>
        <Updated />
        <p>Welcome to A&amp;P Creative Hub! 💖</p>
        <p>These Terms &amp; Conditions explain the rules and guidelines for using our website, purchasing our products, making payments and accessing our services.</p>
        <p>By visiting or purchasing from our website, you agree to the Terms &amp; Conditions below. Please read them carefully before placing an order.</p>
        <p>
          In these terms, “You”, “Your” and “Customer” refer to the person using our website. “We”, “Us”, “Our” and “Company” refer to A&amp;P Creative Hub. These
          terms are governed by the applicable laws of India.
        </p>

        <h2>1. General conditions</h2>
        <ul>
          <li>We reserve the right to refuse or cancel orders for legitimate reasons, including suspected fraudulent activity, misuse or violations of these terms, subject to applicable laws.</li>
          <li>Customers must use our website for lawful purposes.</li>
          <li>You must not misuse, damage or interfere with the proper functioning of our website.</li>
          <li>You may not copy, reproduce, resell or commercially exploit our website content without our written permission, except where permitted by law.</li>
          <li>
            Personal information will be handled according to our <Link to="/privacy">Privacy Policy</Link>.
          </li>
        </ul>

        <h2>2. Product prices and availability</h2>
        <ul>
          <li>All product prices are displayed in Indian Rupees (INR).</li>
          <li>Product prices may change without prior notice.</li>
          <li>We reserve the right to modify, update or discontinue products at any time.</li>
          <li>Product availability is subject to stock.</li>
          <li>Confirmed orders will generally retain the price displayed at the time of purchase, except where genuine pricing errors require correction in accordance with applicable laws.</li>
          <li>Any applicable additional charges will be displayed during checkout or communicated before order confirmation.</li>
        </ul>

        <h2>3. Products and services</h2>
        <p>A&amp;P Creative Hub offers a variety of products, including:</p>
        <ul>
          <li>Hair accessories and hair clips</li>
          <li>Fashion jewellery and accessories</li>
          <li>Bracelets, chains, earrings and rings</li>
          <li>Trendy stationery products</li>
          <li>Fashionable bags and other lifestyle products</li>
        </ul>
        <p>We make every effort to display accurate product photographs, colours, descriptions and details.</p>
        <p>However, slight variations in colour, appearance or presentation may occur due to lighting, photography and individual screen settings.</p>
        <p>All products are subject to availability.</p>

        <h2>4. Orders and customer information</h2>
        <p>Customers are responsible for providing accurate information while placing orders. Please ensure that the following details are correct:</p>
        <ul>
          <li>Full name</li>
          <li>Contact number</li>
          <li>Complete delivery address</li>
          <li>Email address, where applicable</li>
          <li>Product selection and quantity</li>
        </ul>
        <p>We are not responsible for delivery issues caused by incorrect or incomplete information provided by customers, subject to applicable laws.</p>
        <p>We reserve the right to cancel or refuse orders in cases of suspected fraud, payment verification issues, product unavailability or other legitimate reasons.</p>
        <p>
          If an order is cancelled after payment, any applicable refund will be processed according to our{' '}
          <Link to="/refund-policy">Refund and Cancellation Policy</Link>.
        </p>

        <h2>5. Payment terms</h2>
        <p>We accept online payments through our authorised payment gateway, {gw}. Available payment methods may include:</p>
        <ul>
          <li>UPI</li>
          <li>Debit cards</li>
          <li>Credit cards</li>
          <li>Net banking</li>
          <li>Other payment methods supported at checkout</li>
        </ul>
        <p>Orders will be processed after successful payment confirmation. We do not offer Cash on Delivery.</p>
        <p>We do not store complete credit or debit card details on our website servers.</p>
        <p>Customers should not share their OTP, UPI PIN, passwords or confidential banking information with anyone.</p>

        <h2>6. Intellectual property rights</h2>
        <p>
          All original content belonging to A&amp;P Creative Hub, including our logo, brand name, website text, graphics, product photographs and designs, is protected
          by applicable intellectual property laws.
        </p>
        <p>You may not, without prior written permission:</p>
        <ul>
          <li>Copy or reproduce our original content for commercial use</li>
          <li>Use our logo or brand identity without permission</li>
          <li>Republish our website content</li>
          <li>Redistribute our original photographs or graphics for commercial purposes</li>
        </ul>
        <p>All rights are reserved to their respective owners.</p>

        <h2>7. Website usage and external links</h2>
        <p>Our website may contain links to third-party websites or services for customer convenience.</p>
        <p>We are not responsible for the content, privacy practices or policies of external websites.</p>
        <p>Customers are encouraged to review the terms and privacy policies of third-party websites before using their services.</p>
        <p>We reserve the right to update or remove external links whenever necessary.</p>

        <h2>8. Website information and accuracy</h2>
        <p>We make reasonable efforts to keep our website information accurate and updated.</p>
        <p>However, occasional errors, technical issues or incorrect product information may occur.</p>
        <p>We reserve the right to correct errors, update descriptions and modify website content whenever necessary.</p>
        <p>We do not guarantee uninterrupted website availability, as maintenance, technical issues or external factors may occasionally affect access.</p>

        <h2>9. Shipping and delivery</h2>
        <p>We make reasonable efforts to process and dispatch orders within the timelines communicated on our website.</p>
        <ul>
          <li>Delivery timelines may vary depending on the delivery location and courier service.</li>
          <li>Customers must provide accurate shipping details.</li>
          <li>Shipping charges, if applicable, will be displayed during checkout or communicated before order confirmation.</li>
          <li>Once dispatched, delivery is subject to the courier partner’s service and operational conditions.</li>
          <li>Delays caused by unforeseen circumstances may occasionally occur.</li>
        </ul>
        <p>
          For additional information, please refer to our <Link to="/shipping">Shipping Policy</Link>.
        </p>

        <h2>10. Order cancellation, returns and refunds</h2>
        <p>
          Order cancellations, returns, exchanges and refunds are subject to our published <Link to="/refund-policy">Refund and Cancellation Policy</Link>. Customers
          are encouraged to review the policy before placing an order.
        </p>
        <p>For damaged, defective, incorrect or missing products, please contact us with the relevant order details and supporting evidence.</p>
        <p>
          An unboxing video is mandatory for refund claims under our verification process. Customers should record a clear, continuous and uninterrupted video while
          opening the package.
        </p>
        <p>However, this requirement does not remove or restrict any mandatory consumer rights or remedies available under applicable Indian law.</p>
        <p>Any eligible refund will be processed according to our Refund Policy and applicable legal requirements.</p>

        <h2>11. Customer responsibilities</h2>
        <p>By using our website, you agree to:</p>
        <ul>
          <li>Provide genuine and accurate information</li>
          <li>Use the website responsibly and lawfully</li>
          <li>Avoid fraudulent transactions</li>
          <li>Not misuse promotional offers or discounts</li>
          <li>Not attempt unauthorised access to our website</li>
          <li>Follow the applicable ordering, payment and delivery procedures</li>
        </ul>
        <p>We reserve the right to take appropriate action against misuse, subject to applicable laws.</p>

        <h2>12. Limitation of liability</h2>
        <p>We take reasonable care to provide quality products and a reliable shopping experience.</p>
        <p>
          However, to the extent permitted by applicable law, we are not responsible for indirect losses arising from temporary website interruptions, technical
          issues or circumstances beyond our reasonable control.
        </p>
        <p>Nothing in these Terms &amp; Conditions excludes or limits liability that cannot legally be excluded or restricted under applicable Indian law.</p>
        <p>Your statutory consumer rights remain unaffected.</p>

        <h2>13. Privacy policy</h2>
        <p>We respect your privacy and are committed to protecting your personal information.</p>
        <p>Customer information collected through our website will be handled in accordance with our Privacy Policy and applicable data protection laws.</p>
        <p>
          Please review our <Link to="/privacy">Privacy Policy</Link> to understand how your personal information is collected, used, stored and protected.
        </p>

        <h2>14. Changes to these terms</h2>
        <p>A&amp;P Creative Hub reserves the right to update or modify these Terms &amp; Conditions whenever necessary.</p>
        <p>Any changes will be published on this page with the revised date. Customers are encouraged to review this page periodically.</p>
        <p>Changes will not affect rights already established under applicable law.</p>

        <h2>15. Governing law and jurisdiction</h2>
        <p>These Terms &amp; Conditions shall be governed by the applicable laws of India.</p>
        <p>Any disputes arising from the use of our website or the purchase of our products will be addressed in accordance with applicable Indian laws, including consumer protection laws.</p>
        <p>We appreciate your trust and support. Happy shopping! 🛍️✨</p>

        <h2>Contact us</h2>
        <ContactBlock />
      </PolicyCard>
    </PageShell>
  );
}
