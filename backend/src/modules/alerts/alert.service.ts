import { PrismaClient } from "@prisma/client";
import type { UpdateAlertStatusInput } from "./alert-rule.schema.js";
import { logger } from "../../lib/logger.js";
import { notFound } from "../../lib/http-errors.js";
import { findPage, type PaginationInput } from "../../lib/pagination.js";

export class AlertService {
  constructor(private prisma: PrismaClient) {}

  /**
   * List all alerts for a workspace
   */
  /**
   * Paginated alert list (Batch 10).
   *
   * Previously unbounded: `findMany` with no `skip`/`take` returned every alert
   * the workspace had ever raised, which grows without limit as rules keep
   * firing.
   */
  async list(
    workspaceId: string,
    organizationId: string,
    status: string | undefined,
    paging: PaginationInput,
  ) {
    const where = {
      organizationId,
      workspaceId,
      ...(status ? { status: status as any } : {}),
    };
    const { items, meta } = await findPage(
      () =>
        this.prisma.alert.findMany({
          where,
          include: { rule: true },
          orderBy: { createdAt: 'desc' as const },
          skip: (paging.page - 1) * paging.limit,
          take: paging.limit,
        }),
      () => this.prisma.alert.count({ where }),
      paging.page,
      paging.limit,
    );

    return { alerts: items, meta };
  }

  /**
   * Get a single alert
   */
  async get(id: string, organizationId: string) {
    const alert = await this.prisma.alert.findFirst({
      where: { id, organizationId },
      include: {
        rule: true,
      },
    });

    if (!alert) {
      throw notFound('Alert not found');
    }

    return { alert };
  }

  /**
   * Update alert status
   */
  async updateStatus(id: string, input: UpdateAlertStatusInput, organizationId: string) {
    const existing = await this.prisma.alert.findFirst({
      where: { id, organizationId },
    });

    if (!existing) {
      throw notFound('Alert not found');
    }

    const alert = await this.prisma.alert.update({
      where: { id },
      data: { status: input.status },
    });

    logger.info({ alertId: id, status: input.status }, 'Alert status updated');
    return { alert };
  }
}
