/**
 * Batch upload endpoint (Requirement 11).
 *
 * Mutating REST route over the {@link BatchUploadService}. A Batch_Upload is an
 * Administrator-only, Season-scoped action; the route is guarded by the `admin`
 * resource and the service re-checks Administrator authorization itself.
 *
 *   - POST /seasons/:seasonId/batch-upload   import Teams and Players from an
 *                                            uploaded file (Req 11.2).
 *
 * The file is carried in the JSON body as base64 (`fileBase64`) together with
 * the original `filename` and optional `mimeType`, avoiding a multipart
 * dependency while still giving the service the raw bytes and the metadata it
 * uses to detect the CSV/.xlsx format (Req 11.5) and reject an empty file
 * (Req 11.6). Choosing JSON base64 keeps the transport minimal and typecheck
 * green.
 *
 * The service runs the all-or-nothing import (Req 11.3) and returns the record
 * count on success; any invalid row is surfaced as a single 4xx via the central
 * error handler. A successful import returns 201 with the record counts.
 *
 * _Requirements: 11.2_
 */
import { Router } from 'express';
import { authenticate, authorizeRequest, type ResourceResolver } from '../middleware/auth.js';
import { db } from '../../db/client.js';
import { AuthenticationError, ValidationError } from '../../domain/errors.js';
import { BatchUploadService } from '../../services/batchUploadService.js';
import { asyncHandler, param, readBody, readOptionalString, readString } from './helpers.js';

/** Administrator-only resource for Season-scoped Batch_Upload. */
const adminResource: ResourceResolver = () => ({ kind: 'admin' });

/** Decode a base64 payload into a Buffer, rejecting malformed input. */
function decodeBase64(field: string, value: string): Buffer {
  try {
    return Buffer.from(value, 'base64');
  } catch {
    throw new ValidationError(`The field "${field}" must be base64-encoded.`, {
      field,
    });
  }
}

/** Build the Batch_Upload router. */
export function createBatchRouter(): Router {
  const router = Router();
  const service = new BatchUploadService(db);

  router.post(
    '/:seasonId/batch-upload',
    authenticate(),
    authorizeRequest('create', adminResource),
    asyncHandler(async (req, res) => {
      const auth = req.auth;
      if (!auth) throw new AuthenticationError('Authentication is required.');
      const body = readBody(req);
      const buffer = decodeBase64('fileBase64', readString(body, 'fileBase64'));
      const result = await service.uploadTeamsAndPlayers(auth.user, {
        seasonId: param(req.params.seasonId),
        file: {
          buffer,
          filename: readOptionalString(body, 'filename'),
          mimeType: readOptionalString(body, 'mimeType'),
        },
      });
      res.status(201).json(result);
    }),
  );

  return router;
}
