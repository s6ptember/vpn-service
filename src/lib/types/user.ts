export interface SessionUser {
	id: number;
	telegramId: number;
	username: string | null;
	firstName: string;
	lastName: string | null;
	photoUrl: string | null;
	isAdmin: boolean; // derived from ADMIN_CHAT_ID, never stored
}
