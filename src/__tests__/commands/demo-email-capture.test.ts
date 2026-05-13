/**
 * Email-capture flow for `solid demo create` — Layer 1B of CLI monetization.
 * Covers the skip conditions (telemetry disabled, non-TTY, identity already
 * has email) and the happy path (validate → captureEmail → telemetry).
 */

import { EMAIL_RE, captureEmailForDemo } from '../../commands/demo';

const mockCaptureEmail = jest.fn();
const mockGetIdentity = jest.fn();
const mockTuiInput = jest.fn();
const mockIsInteractive = jest.fn();
const mockEmit = jest.fn();

jest.mock('../../lib/first-run', () => ({
  captureEmail: (...args: unknown[]) => mockCaptureEmail(...args),
  getIdentity: () => mockGetIdentity(),
}));

jest.mock('../../lib/tui', () => ({
  input: (...args: unknown[]) => mockTuiInput(...args),
  isInteractive: () => mockIsInteractive(),
}));

jest.mock('../../lib/telemetry', () => ({
  emit: (...args: unknown[]) => mockEmit(...args),
}));

describe('demo create — email capture', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.SOLID_DISABLE_TELEMETRY;
    mockIsInteractive.mockReturnValue(true);
    mockGetIdentity.mockReturnValue(null);
    mockTuiInput.mockResolvedValue('user@example.com');
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  describe('EMAIL_RE', () => {
    it('accepts well-formed addresses', () => {
      expect(EMAIL_RE.test('a@b.co')).toBe(true);
      expect(EMAIL_RE.test('first.last+tag@example.com')).toBe(true);
    });

    it('rejects malformed addresses', () => {
      expect(EMAIL_RE.test('')).toBe(false);
      expect(EMAIL_RE.test('not-an-email')).toBe(false);
      expect(EMAIL_RE.test('a@b')).toBe(false);
      expect(EMAIL_RE.test('a @b.co')).toBe(false);
    });
  });

  describe('captureEmailForDemo', () => {
    it('skips when SOLID_DISABLE_TELEMETRY=1', async () => {
      process.env.SOLID_DISABLE_TELEMETRY = '1';
      await captureEmailForDemo('plumber');
      expect(mockTuiInput).not.toHaveBeenCalled();
      expect(mockCaptureEmail).not.toHaveBeenCalled();
      expect(mockEmit).not.toHaveBeenCalled();
    });

    it('skips when stdin is not a TTY', async () => {
      mockIsInteractive.mockReturnValue(false);
      await captureEmailForDemo('plumber');
      expect(mockTuiInput).not.toHaveBeenCalled();
      expect(mockCaptureEmail).not.toHaveBeenCalled();
    });

    it('skips when identity already has an email', async () => {
      mockGetIdentity.mockReturnValue({ machine_id: 'm1', email: 'old@example.com' });
      await captureEmailForDemo('plumber');
      expect(mockTuiInput).not.toHaveBeenCalled();
      expect(mockCaptureEmail).not.toHaveBeenCalled();
    });

    it('prompts, persists, and emits telemetry on the happy path', async () => {
      mockTuiInput.mockResolvedValue('new@user.com  ');
      await captureEmailForDemo('hvac');
      expect(mockTuiInput).toHaveBeenCalledTimes(1);
      expect(mockCaptureEmail).toHaveBeenCalledWith('new@user.com', 'demo-create');
      expect(mockEmit).toHaveBeenCalledWith(
        'demo_email_captured',
        expect.objectContaining({
          command: 'demo create',
          extra: expect.objectContaining({ template: 'hvac', source: 'demo-create' }),
        }),
      );
    });

    it('never throws if captureEmail rejects', async () => {
      mockCaptureEmail.mockRejectedValue(new Error('disk full'));
      await expect(captureEmailForDemo('plumber')).resolves.toBeUndefined();
    });
  });

  describe('validator passed to tui.input', () => {
    it('rejects empty and malformed input, accepts valid', async () => {
      let capturedValidator: ((v: string) => true | string) | undefined;
      mockTuiInput.mockImplementation(async (_msg: unknown, opts: { validate?: (v: string) => true | string }) => {
        capturedValidator = opts.validate;
        return 'good@email.com';
      });

      await captureEmailForDemo('plumber');

      expect(capturedValidator).toBeDefined();
      expect(capturedValidator!('')).toBe('Email is required to deliver the phone number.');
      expect(capturedValidator!('garbage')).toBe("That doesn't look like a valid email.");
      expect(capturedValidator!('good@email.com')).toBe(true);
    });
  });
});
