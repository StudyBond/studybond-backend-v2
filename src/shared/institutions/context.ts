import prisma from '../../config/database';
import { INSTITUTION_CONFIG } from '../../config/constants';
import { NotFoundError } from '../errors/NotFoundError';

type InstitutionClient = {
  institution: {
    findFirst: (args: Record<string, unknown>) => Promise<any>;
    findUnique: (args: Record<string, unknown>) => Promise<any>;
  };
  user: {
    findUnique: (args: Record<string, unknown>) => Promise<any>;
  };
};

export interface ResolvedInstitutionContext {
  id: number;
  code: string;
  name: string;
  slug: string;
  studyModeEnabled: boolean;
  source: 'explicit' | 'user_target' | 'launch_default';
}

const institutionSelect = {
  id: true,
  code: true,
  name: true,
  slug: true,
  examConfigs: {
    where: { isActive: true },
    select: { studyModeEnabled: true },
    take: 1
  }
} as const;

function formatInstitution(inst: any): Omit<ResolvedInstitutionContext, 'source'> {
  return {
    id: inst.id,
    code: inst.code,
    name: inst.name,
    slug: inst.slug,
    studyModeEnabled: inst.examConfigs?.[0]?.studyModeEnabled ?? false,
  };
}

async function findActiveInstitutionByCode(
  db: InstitutionClient,
  code: string
): Promise<Omit<ResolvedInstitutionContext, 'source'> | null> {
  const institution = await db.institution.findFirst({
    where: {
      code,
      isActive: true
    },
    select: institutionSelect
  });

  if (!institution) {
    return null;
  }

  return formatInstitution(institution);
}

async function findActiveInstitutionById(
  db: InstitutionClient,
  institutionId: number
): Promise<Omit<ResolvedInstitutionContext, 'source'> | null> {
  const institution = await db.institution.findFirst({
    where: {
      id: institutionId,
      isActive: true
    },
    select: institutionSelect
  });

  if (!institution) {
    return null;
  }

  return formatInstitution(institution);
}

export class InstitutionContextService {
  private readonly launchInstitutionCode = INSTITUTION_CONFIG.LAUNCH_INSTITUTION_CODE;

  async resolveForUser(
    userId: number,
    explicitInstitutionCode?: string | null,
    db: InstitutionClient = prisma as unknown as InstitutionClient
  ): Promise<ResolvedInstitutionContext> {
    if (explicitInstitutionCode) {
      const explicit = await findActiveInstitutionByCode(db, explicitInstitutionCode.trim().toUpperCase());
      if (!explicit) {
        throw new NotFoundError(`Institution ${explicitInstitutionCode.trim().toUpperCase()} is not available.`);
      }

      return {
        ...explicit,
        source: 'explicit'
      };
    }

    const user = await db.user.findUnique({
      where: { id: userId },
      select: {
        targetInstitution: {
          select: institutionSelect
        }
      }
    });

    const targetInstitution = user?.targetInstitution;
    if (targetInstitution) {
      return {
        ...targetInstitution,
        source: 'user_target'
      };
    }

    const launchInstitution = await findActiveInstitutionByCode(db, this.launchInstitutionCode);
    if (!launchInstitution) {
      throw new NotFoundError(`Launch institution ${this.launchInstitutionCode} is not configured.`);
    }

    return {
      ...launchInstitution,
      source: 'launch_default'
    };
  }

  async resolveByCode(
    institutionCode?: string | null,
    db: InstitutionClient = prisma as unknown as InstitutionClient
  ): Promise<ResolvedInstitutionContext> {
    const normalized = institutionCode?.trim().toUpperCase() || this.launchInstitutionCode;
    const institution = await findActiveInstitutionByCode(db, normalized);
    if (!institution) {
      throw new NotFoundError(`Institution ${normalized} is not available.`);
    }

    return {
      ...institution,
      source: normalized === this.launchInstitutionCode ? 'launch_default' : 'explicit'
    };
  }

  async resolveById(
    institutionId: number,
    db: InstitutionClient = prisma as unknown as InstitutionClient
  ): Promise<ResolvedInstitutionContext> {
    const institution = await findActiveInstitutionById(db, institutionId);
    if (!institution) {
      throw new NotFoundError(`Institution ${institutionId} is not available.`);
    }

    return {
      ...institution,
      source: 'explicit'
    };
  }
}

export const institutionContextService = new InstitutionContextService();
