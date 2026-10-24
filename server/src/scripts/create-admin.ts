/**
 * Provision an administrator or staff account from the command line.
 * This is the ONLY way to create staff/admin users — there is no public
 * admin signup. See docs/SETUP.md (First admin).
 *
 *   npm run admin:create -- --email owner@example.com --name "Owner Name"
 *   npm run admin:create -- --email helper@example.com --name "Helper" --role staff
 *   npm run admin:create -- --email existing@example.com --promote
 *
 * The password is prompted for (hidden input). For non-interactive
 * environments set ADMIN_PASSWORD for this one command only.
 */
import readline from 'node:readline';
import { parseArgs } from 'node:util';
import { connectDb, disconnectDb } from '../config/db.js';
import { normalizeEmail } from '../lib/util.js';
import { Session } from '../models/Session.js';
import { User } from '../models/User.js';
import { hashPassword } from '../services/auth.service.js';

const MIN_ADMIN_PASSWORD = 12;

function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const rlAny = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
    let muted = false;
    rlAny._writeToOutput = (s: string) => {
      if (!muted) rlAny.output.write(s);
      else if (s.includes('\n') || s.includes('\r')) rlAny.output.write('\n');
      else rlAny.output.write('*');
    };
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
    muted = true;
  });
}

function checkStrength(pw: string): string | null {
  if (pw.length < MIN_ADMIN_PASSWORD) return `Use at least ${MIN_ADMIN_PASSWORD} characters.`;
  if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw) || !/[0-9]/.test(pw)) return 'Include upper-case, lower-case letters and a number.';
  return null;
}

async function main() {
  const { values } = parseArgs({
    options: {
      email: { type: 'string' },
      name: { type: 'string' },
      role: { type: 'string', default: 'admin' },
      promote: { type: 'boolean', default: false },
    },
  });
  if (!values.email) {
    console.error('Usage: npm run admin:create -- --email you@example.com --name "Your Name" [--role admin|staff] [--promote]');
    process.exit(1);
  }
  const role = values.role === 'staff' ? 'staff' : values.role === 'admin' ? 'admin' : null;
  if (!role) {
    console.error('--role must be "admin" or "staff".');
    process.exit(1);
  }
  const email = normalizeEmail(values.email);

  let password = process.env.ADMIN_PASSWORD ?? '';
  if (!password) {
    password = await promptHidden(`Password for ${email}: `);
    const confirm = await promptHidden('Confirm password: ');
    if (password !== confirm) {
      console.error('Passwords do not match.');
      process.exit(1);
    }
  }
  const weak = checkStrength(password);
  if (weak) {
    console.error(`Password too weak: ${weak}`);
    process.exit(1);
  }

  await connectDb();
  const existing = await User.findOne({ email });
  if (existing && !values.promote) {
    console.error(`A user with ${email} already exists (role: ${existing.role}). Re-run with --promote to change their role and reset their password.`);
    await disconnectDb();
    process.exit(1);
  }

  const passwordHash = await hashPassword(password);
  if (existing) {
    existing.role = role;
    existing.passwordHash = passwordHash;
    existing.isActive = true;
    existing.passwordChangedAt = new Date();
    await existing.save();
    await Session.deleteMany({ user: existing._id });
    console.log(`✔ ${email} is now ${role}. Existing sessions were signed out.`);
  } else {
    if (!values.name) {
      console.error('--name is required when creating a new account.');
      await disconnectDb();
      process.exit(1);
    }
    await User.create({ name: values.name, email, passwordHash, role });
    console.log(`✔ Created ${role} account for ${email}. Sign in at /admin/login.`);
  }
  await disconnectDb();
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err);
  await disconnectDb().catch(() => undefined);
  process.exit(1);
});
