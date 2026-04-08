/**
 * Audit Log Service - Fire-and-Forget Implementation
 * 
 * This service logs lender-side actions to UiPath Entities.
 * It uses a fire-and-forget pattern: errors are caught and logged
 * to console but NEVER propagated to the calling code.
 * 
 * IMPORTANT: This service should NEVER break the main application flow.
 */

import { Entities } from '@uipath/uipath-typescript/entities';
import type { UiPath } from '@uipath/uipath-typescript/core';
import type { AuditLogEntry, AuditLogInput, AuditUserRole } from '../types/audit';

/**
 * Get the audit log entity ID from environment variables
 */
const AUDIT_LOG_ENTITY_ID = import.meta.env.VITE_AUDIT_LOG_ENTITY_ID;

/**
 * Get client IP address (best effort, falls back to 'unknown')
 */
function getClientIpAddress(): string {
  try {
    return 'client-side';
  } catch {
    return 'unknown';
  }
}

/**
 * Get user agent string
 */
function getUserAgent(): string {
  try {
    return navigator.userAgent || 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Core audit log function - Fire and Forget
 * 
 * This function:
 * 1. Creates an audit log entry via backend API
 * 2. Catches ALL errors and logs them silently
 * 3. NEVER throws or rejects
 * 
 * @param entry - Complete audit log entry
 */
export async function logAuditEntry(entry: AuditLogEntry): Promise<void> {
  // Fire-and-forget: wrap everything in try-catch
  try {
    // Skip if entity ID is not configured
    if (!AUDIT_LOG_ENTITY_ID) {
      console.warn('[AuditLog] Audit log entity ID not configured. Set VITE_AUDIT_LOG_ENTITY_ID in .env');
      return;
    }

    // Build the record with all fields
    const recordData: Record<string, any> = {
      UserId: entry.UserId,
      UserRole: entry.UserRole,
      Action: entry.Action,
      EntityType: entry.EntityType,
      EntityId: entry.EntityId,
      CaseId: entry.CaseId,
      IpAddress: entry.IpAddress,
      UserAgent: entry.UserAgent || '',
      Description: entry.Description,
      Severity: entry.Severity,
      AuditEntityId: AUDIT_LOG_ENTITY_ID,
    };

    // Add optional fields only if they exist
    if (entry.OldValue) {
      recordData.OldValue = entry.OldValue;
    }
    if (entry.NewValue) {
      recordData.NewValue = entry.NewValue;
    }

    // Send to backend API for audit logging
    const baseUrl = import.meta.env.VITE_API_BASE_URL;
    const response = await fetch(`${baseUrl}/api/audit/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(recordData),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    // Success log (not an error, just for debugging)
    console.log('[AuditLog] Successfully logged:', entry.Action, '-', entry.Description);
  } catch (error) {
    // FIRE-AND-FORGET: Log error but NEVER propagate
    console.error('[AuditLog] Error logging audit entry (non-blocking):', error);
    console.error('[AuditLog] Failed entry action:', entry.Action, 'entity:', entry.EntityType);
  }
}

/**
 * Build a complete audit log entry from simplified input
 */
export function buildAuditLogEntry(
  userId: string,
  userRole: AuditUserRole,
  input: AuditLogInput
): AuditLogEntry {
  return {
    UserId: userId,
    UserRole: userRole,
    Action: input.action,
    EntityType: input.entityType,
    EntityId: input.entityId,
    CaseId: input.caseId,
    OldValue: input.oldValue ? JSON.stringify(input.oldValue) : undefined,
    NewValue: input.newValue ? JSON.stringify(input.newValue) : undefined,
    IpAddress: getClientIpAddress(),
    UserAgent: getUserAgent(),
    Description: input.description,
    Severity: input.severity || 'Info',
  };
}

/**
 * Fire-and-forget audit helper
 * 
 * Usage: Call this function with the audit input.
 * It will log the action asynchronously without blocking or throwing.
 */
export async function fireAuditLog(
  userId: string | null,
  userRole: string | null,
  input: AuditLogInput
): Promise<void> {
  // Guard: Skip if missing required data
  if (!userId || !userRole) {
    console.warn('[AuditLog] Skipping audit log - missing required context');
    return;
  }

  // Guard: Skip for borrower role (lender-only logging)
  if (userRole === 'Borrower') {
    return;
  }

  // Validate userRole is a valid AuditUserRole
  const validRoles: AuditUserRole[] = ['Loan Officer', 'Underwriter', 'Admin'];
  if (!validRoles.includes(userRole as AuditUserRole)) {
    console.warn('[AuditLog] Skipping audit log - invalid role:', userRole);
    return;
  }

  // Build the entry and log it (fire-and-forget)
  const entry = buildAuditLogEntry(userId, userRole as AuditUserRole, input);
  
  // Fire and forget - don't await, don't catch
  logAuditEntry(entry).catch(() => {
    // This catch is just a safety net - errors are already handled inside logAuditEntry
  });
}
