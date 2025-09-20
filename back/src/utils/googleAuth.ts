// AI : Google OAuth utility functions
export async function verifyGoogleToken(token: string): Promise<{ 
  googleId: string; 
  email: string; 
  name: string; 
  picture?: string 
} | null> {
  try {
    const { OAuth2Client } = await import('google-auth-library');
    const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
    
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    
    const payload = ticket.getPayload();
    if (!payload?.sub || !payload?.email || !payload.name) {
      return null;
    }
    
    return {
      googleId: payload.sub, // AI : Google's unique user ID - this is the secure identifier
      email: payload.email,
      name: payload.name,
      picture: payload.picture,
    };
  } catch (error) {
    console.error('Google token verification error:', error);
    return null;
  }
}