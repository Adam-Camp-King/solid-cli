/**
 * API Client tests — verifies error handling and request shapes.
 * Mocks axios so NO real HTTP calls are made.
 */

import { handleApiError } from '../../lib/api-client';
import axios from 'axios';

describe('handleApiError', () => {
  it('extracts detail from axios error response', () => {
    jest.spyOn(axios, 'isAxiosError').mockReturnValue(true);
    const error = {
      isAxiosError: true,
      response: { status: 404, data: { detail: 'Not found' } },
      message: 'Request failed',
    };
    const result = handleApiError(error);
    expect(result.message).toBe('Not found');
    expect(result.status).toBe(404);
  });

  it('extracts message field when detail is missing', () => {
    jest.spyOn(axios, 'isAxiosError').mockReturnValue(true);
    const error = {
      isAxiosError: true,
      response: { status: 400, data: { message: 'Bad request' } },
      message: 'Request failed',
    };
    const result = handleApiError(error);
    expect(result.message).toBe('Bad request');
    expect(result.status).toBe(400);
  });

  it('falls back to axios message when no response data', () => {
    jest.spyOn(axios, 'isAxiosError').mockReturnValue(true);
    const error = {
      isAxiosError: true,
      response: { status: 500, data: {} },
      message: 'Network Error',
    };
    const result = handleApiError(error);
    expect(result.message).toBe('Network Error');
  });

  it('handles non-axios Error objects', () => {
    jest.spyOn(axios, 'isAxiosError').mockReturnValue(false);
    const result = handleApiError(new Error('Connection timeout'));
    expect(result.message).toBe('Connection timeout');
    expect(result.status).toBe(500);
  });

  it('handles unknown error types', () => {
    jest.spyOn(axios, 'isAxiosError').mockReturnValue(false);
    const result = handleApiError('some string error');
    expect(result.message).toBe('Unknown error');
    expect(result.status).toBe(500);
  });

  it('handles null/undefined errors', () => {
    jest.spyOn(axios, 'isAxiosError').mockReturnValue(false);
    const result = handleApiError(null);
    expect(result.message).toBe('Unknown error');
  });

  it('returns 401 status for auth errors', () => {
    jest.spyOn(axios, 'isAxiosError').mockReturnValue(true);
    const error = {
      isAxiosError: true,
      response: { status: 401, data: { detail: 'Token expired' } },
      message: 'Unauthorized',
    };
    const result = handleApiError(error);
    expect(result.status).toBe(401);
    expect(result.message).toBe('Token expired');
  });
});
