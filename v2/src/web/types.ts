// Contratos de la API (ver src/worker/routes/*).
export type DayStatus = 'free' | 'busy' | 'maybe';
export type TripRole = 'owner' | 'editor' | 'member';
export type TripStatus = 'planning' | 'decided' | 'done' | 'cancelled';

export interface OwnProfile { id: string; alias: string; email: string | null; role: string; homeOriginId: string | null; createdAt: number }
export interface MeResponse { profile: OwnProfile | null; needsAlias: boolean }
export interface PublicUser { id: string; alias: string }

export interface FriendsResponse {
  friends: { id: string; alias: string; since: number }[];
  incoming: { id: string; user_id: string; alias: string; created_at: number }[];
  outgoing: { id: string; user_id: string; alias: string; created_at: number }[];
  blocked: PublicUser[];
}

export interface Trip {
  id: string; ownerId: string; name: string; originId: string | null; startDate: string | null; endDate: string | null;
  nights: number | null; skiDays: number | null; participantsPlanned: number | null; cars: number | null;
  budgetCents: number | null; areaId: string | null; status: TripStatus; membersCanInvite: boolean;
  version: number; createdAt: number; updatedAt: number; role?: TripRole;
}
export interface TripMember { id: string; alias: string; role: TripRole; joined_at: number }
export interface TripInvitation {
  id: string; invitee_id: string | null; invitee_alias: string | null; is_link: number; status: string; expires_at: number; uses: number; max_uses: number;
}
export interface TripDetail { trip: Trip & { role: TripRole }; members: TripMember[]; invitations: TripInvitation[] }
export interface MyInvitation { id: string; trip_id: string; trip_name: string; inviter_alias: string; expires_at: number; created_at: number }

export interface DailyCount { day: string; free: number; maybe: number; busy: number; unknown: number; hidden: number }
export interface CandidateWindow {
  start: string; end: string; nights: number;
  free: string[]; maybe: string[]; unknown: string[]; busy: string[]; hidden: string[];
  meetsWithFree: boolean; meetsWithMaybe: boolean;
}
export interface PersonAvailability { id: string; shared: boolean; days: Record<string, DayStatus> | null }
export interface CommonResponse { people: PersonAvailability[]; daily: DailyCount[]; windows: CandidateWindow[] }
export interface Proposal {
  id: string; start_date: string; end_date: string; proposed_by: string; proposed_by_alias: string;
  votes: { userId: string; value: 'yes' | 'maybe' | 'no' }[];
}
export interface TripCalendarResponse extends CommonResponse { members: PublicUser[]; proposals: Proposal[] }
export interface SharesResponse { friends: boolean; trips: { id: string; name: string | null }[] }
