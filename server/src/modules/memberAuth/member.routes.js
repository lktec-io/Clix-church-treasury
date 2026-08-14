import { Router } from 'express';
import * as memberController from './member.controller.js';

// Every route here already sits behind authenticateMember + memberContext
// (applied once at the app.js mount point, not per-route — there is no
// RBAC permission system for members, since access is pure data-scoping
// by req.contributorId, not role-based).
export function memberRoutes() {
  const router = Router();
  router.get('/contributions', memberController.listContributions);
  router.get('/statement', memberController.statement);
  router.get('/year-total', memberController.yearTotal);
  router.get('/statement/pdf', memberController.statementPdf);
  router.get('/receipts/:id/pdf', memberController.receiptPdf);
  return router;
}
