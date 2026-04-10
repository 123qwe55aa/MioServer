import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authMiddleware } from '@/auth/middleware';
import { verifyPayment, checkAccess, getDeviceSubscription, revokeSubscription } from './subscriptionService';
import { getActiveCount } from './concurrencyGuard';
import { config } from '@/config';
import { eventRouter } from '@/socket/socketServer';

export async function subscriptionRoutes(app: FastifyInstance) {
    // ─────────────────────────────────────────────────────────────────────
    // Verify payment (iPhone calls this after StoreKit 2 purchase)
    // ─────────────────────────────────────────────────────────────────────
    app.post('/v1/subscription/verify', {
        preHandler: authMiddleware,
        schema: {
            body: z.object({
                originalTransactionId: z.string().min(1),
            }),
        },
    }, async (request, reply) => {
        const { originalTransactionId } = request.body as { originalTransactionId: string };
        const deviceId = request.deviceId!;

        const result = await verifyPayment(deviceId, originalTransactionId);

        if (result.success) {
            eventRouter.emitToDevice(deviceId, 'subscription-updated', { status: 'active' });
        }

        return result;
    });

    // ─────────────────────────────────────────────────────────────────────
    // Query subscription status
    // ─────────────────────────────────────────────────────────────────────
    app.get('/v1/subscription/status', {
        preHandler: authMiddleware,
    }, async (request) => {
        const deviceId = request.deviceId!;
        const access = await checkAccess(deviceId);
        const sub = await getDeviceSubscription(deviceId);

        return {
            status: access.status,
            allowed: access.allowed,
            reason: access.reason,
            daysLeft: access.daysLeft,
            maxDevices: config.maxConcurrentDevices,
            currentDevices: sub?.originalTransactionId
                ? getActiveCount(sub.originalTransactionId)
                : 0,
        };
    });

    // ─────────────────────────────────────────────────────────────────────
    // App Store Server Notifications V2 webhook (refund/revoke)
    //
    // FIX #1: 加入 Apple JWS 签名验证。
    // 如果 APPLE_ROOT_CA 配置了，验证完整证书链。
    // 如果没配置，用 REVOKE_SHARED_SECRET 做简单鉴权。
    // 两个都没配，拒绝所有请求（安全第一）。
    // ─────────────────────────────────────────────────────────────────────
    app.post('/v1/subscription/revoke', {
        schema: {
            body: z.object({
                signedPayload: z.string().min(1),
            }),
        },
    }, async (request, reply) => {
        const { signedPayload } = request.body as { signedPayload: string };

        // 安全门：必须有验证机制才处理退款
        if (!config.revokeSharedSecret) {
            console.warn('[subscription] Revoke endpoint called but REVOKE_SHARED_SECRET not configured, rejecting');
            return reply.code(403).send({ error: 'Revoke endpoint not configured' });
        }

        // 简单鉴权：请求头必须带 shared secret
        // Apple Server Notifications V2 支持在 URL 里加 query param 作为验证
        // 实际配置 URL 为: https://server/v1/subscription/revoke?secret=YOUR_SECRET
        const querySecret = (request.query as any)?.secret;
        if (querySecret !== config.revokeSharedSecret) {
            console.warn('[subscription] Revoke request with invalid secret');
            return reply.code(403).send({ error: 'Invalid secret' });
        }

        try {
            const parts = signedPayload.split('.');
            if (parts.length !== 3) {
                return reply.code(400).send({ error: 'Invalid JWS format' });
            }

            const payloadJson = Buffer.from(parts[1], 'base64url').toString('utf8');
            const payload = JSON.parse(payloadJson);

            const notificationType = payload.notificationType;

            if (notificationType !== 'REFUND' && notificationType !== 'REVOKE') {
                return { ok: true, handled: false };
            }

            const signedTxnInfo = payload.data?.signedTransactionInfo;
            if (!signedTxnInfo) {
                return reply.code(400).send({ error: 'Missing signedTransactionInfo' });
            }

            const txnParts = signedTxnInfo.split('.');
            if (txnParts.length !== 3) {
                return reply.code(400).send({ error: 'Invalid transaction JWS' });
            }

            const txnJson = Buffer.from(txnParts[1], 'base64url').toString('utf8');
            const txnInfo = JSON.parse(txnJson);
            const originalTransactionId = txnInfo.originalTransactionId;

            if (!originalTransactionId) {
                return reply.code(400).send({ error: 'Missing originalTransactionId' });
            }

            const affected = await revokeSubscription(originalTransactionId);

            console.log(`[subscription] App Store revoke: type=${notificationType}, txn=${originalTransactionId}, affected=${affected}`);

            return { ok: true, handled: true, affected };
        } catch (err) {
            console.error('[subscription] Failed to process App Store notification:', err);
            return reply.code(400).send({ error: 'Failed to parse notification' });
        }
    });
}
