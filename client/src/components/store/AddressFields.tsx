import type { FieldError, UseFormRegister } from 'react-hook-form';
import { z } from 'zod';
import { INDIAN_STATES, normalizePhone } from '../../lib/constants';
import { Input, Select } from '../ui/Field';

export const phoneSchema = z.preprocess(
  (v) => (typeof v === 'string' ? normalizePhone(v) : v),
  z.string().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit mobile number'),
);

export const addressSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter the recipient’s name').max(100),
  phone: phoneSchema,
  line1: z.string().trim().min(3, 'Enter house / flat and street').max(200),
  line2: z.string().trim().max(200).optional(),
  landmark: z.string().trim().max(120).optional(),
  city: z.string().trim().min(2, 'Enter your city').max(80),
  state: z.enum(INDIAN_STATES, { error: 'Select your state' }),
  pincode: z.string().trim().regex(/^[1-9][0-9]{5}$/, 'Enter a valid 6-digit PIN code'),
});
export type AddressInput = z.infer<typeof addressSchema>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyForm = any;

/** Address inputs bound to a react-hook-form under `prefix` (e.g. "address."). */
export function AddressFields({
  register,
  errors,
  prefix = '',
}: {
  register: UseFormRegister<AnyForm>;
  errors?: Partial<Record<keyof AddressInput, Pick<FieldError, 'message'> | undefined>>;
  prefix?: string;
}) {
  const p = (name: keyof AddressInput) => `${prefix}${name}`;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Input label="Full name" autoComplete="name" required {...register(p('fullName'))} error={errors?.fullName?.message} />
      <Input label="Mobile number" type="tel" inputMode="tel" autoComplete="tel-national" required prefix="+91" {...register(p('phone'))} error={errors?.phone?.message} />
      <Input wrapperClassName="sm:col-span-2" label="House / flat, street" autoComplete="address-line1" required {...register(p('line1'))} error={errors?.line1?.message} />
      <Input label="Area / locality" autoComplete="address-line2" {...register(p('line2'))} error={errors?.line2?.message} />
      <Input label="Landmark" {...register(p('landmark'))} error={errors?.landmark?.message} />
      <Input label="City" autoComplete="address-level2" required {...register(p('city'))} error={errors?.city?.message} />
      <Input label="PIN code" inputMode="numeric" autoComplete="postal-code" maxLength={6} required {...register(p('pincode'))} error={errors?.pincode?.message} />
      <Select wrapperClassName="sm:col-span-2" label="State" autoComplete="address-level1" required {...register(p('state'))} error={errors?.state?.message} defaultValue="">
        <option value="" disabled>
          Select state
        </option>
        {INDIAN_STATES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </Select>
    </div>
  );
}
