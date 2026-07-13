import type { WiseClient } from "./types.js";

export function createWiseClient(): WiseClient | undefined {
	const token = process.env["WISE_API_TOKEN"];
	const profileId = process.env["WISE_PROFILE_ID"];

	if (!token || !profileId) {
		return undefined;
	}

	return {
		fetchActivities: (since, until) =>
			fetch(`https://api.transferwise.com/v1/profiles/${profileId}/activities?since=${since}&until=${until}`, {
				headers: { Authorization: `Bearer ${token}` },
			}),
	};
}