// AI : Google OAuth utility functions
export async function verifyGoogleToken(token: string): Promise<{ email: string; name: string; picture?: string } | null> {
  try {
    const { OAuth2Client } = await import('google-auth-library');
    const client = new OAuth2Client(process.env.VITE_GOOGLE_CLIENT_ID);
    
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: process.env.VITE_GOOGLE_CLIENT_ID,
    });
    
    const payload = ticket.getPayload();
    if (!payload?.email || !payload.name) {
      return null;
    }
    
    return {
      email: payload.email,
      name: payload.name,
      picture: payload.picture,
    };
  } catch (error) {
    console.error('Google token verification error:', error);
    return null;
  }
}