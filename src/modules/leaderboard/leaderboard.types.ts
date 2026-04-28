export type LeaderboardType = 'WEEKLY' | 'ALL_TIME';

export interface LeaderboardInstitution {
  id: number;
  code: string;
  name: string;
  slug: string;
}

export interface LeaderboardEntry {
  rank: number;
  userId: number;
  fullName: string;
  points: number;
  weeklySp: number;
  totalSp: number;
  isCurrentUser: boolean;
}

export interface LeaderboardResponse {
  type: LeaderboardType;
  institution: LeaderboardInstitution;
  limit: number;
  generatedAt: string;
  totalParticipants: number;
  entries: LeaderboardEntry[];
}

export interface RankSummary {
  rank: number | null;
  points: number;
  totalParticipants: number;
}

export interface MyRankResponse {
  institution: LeaderboardInstitution;
  user: {
    id: number;
    fullName: string;
    weeklySp: number;
    totalSp: number;
  };
  weekly: RankSummary;
  allTime: RankSummary;
}

export interface LeaderboardQuery {
  limit?: number;
  institutionCode?: string;
}
