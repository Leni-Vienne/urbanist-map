import { OAuth2Client } from "google-auth-library";

// Google OAuth utility functions
export async function verifyGoogleToken(token: string): Promise<{
  googleId: string;
  email: string;
  emailVerified: boolean;
  name: string;
  picture?: string;
} | null> {
  try {
    const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    if (payload?.sub === undefined || payload?.email === undefined || payload.name === undefined) {
      return null;
    }

    return {
      googleId: payload.sub, // Google's unique user ID - this is the secure identifier
      email: payload.email,
      // Per-token claim, not a property of Google in general. Gates account linking.
      emailVerified: payload.email_verified ?? false,
      name: payload.name,
      picture: payload.picture,
    };
  } catch (error) {
    console.error("Google token verification error:", error);
    return null;
  }
}
