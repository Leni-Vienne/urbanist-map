import { Page, expect } from '@playwright/test';

/**
 * AI : Authentication helpers for Playwright tests
 */
export class AuthTestHelpers {
  constructor(private page: Page) {}

  /**
   * AI : Check if user is currently authenticated
   */
  async isAuthenticated(): Promise<boolean> {
    // AI : Look for user menu or authenticated UI elements using data-testid
    const userMenu = this.page.locator('[data-testid="user-menu"]');
    const signInButton = this.page.locator('[data-testid="sign-in-button"]');
    
    const hasUserMenu = await userMenu.count() > 0;
    const hasSignInButton = await signInButton.count() > 0;
    
    return hasUserMenu && !hasSignInButton;
  }

  /**
   * AI : Open authentication modal
   */
  async openAuthModal() {
    // AI : Look for sign in button using data-testid
    const signInButton = this.page.locator('[data-testid="sign-in-button"]');
    if (await signInButton.count() > 0) {
      await signInButton.click();
      await this.page.waitForTimeout(500);
    }
  }

  /**
   * AI : Perform login with credentials from environment variables
   */
  async login(
    email: string = process.env.TEST_USER_EMAIL ?? 'test@example.com', 
    password: string = process.env.TEST_USER_PASSWORD ?? 'testpassword'
  ) {
    await this.openAuthModal();
    
    // AI : Wait for auth modal to appear
    const authModal = this.page.locator('[data-testid="auth-modal"]');
    if (await authModal.count() > 0) {
      await expect(authModal).toBeVisible();
      
      // AI : Fill login form using data-testid selectors
      const emailInput = this.page.locator('[data-testid="auth-email-input"]');
      const passwordInput = this.page.locator('[data-testid="auth-password-input"] input[type="password"]');
      const loginButton = this.page.locator('[data-testid="auth-submit-button"]');
      
      if (await emailInput.count() > 0) {
        await emailInput.fill(email);
        await passwordInput.fill(password);
        await loginButton.click();
        
        // AI : Wait for login to complete
        await this.page.waitForTimeout(2000);
        
        // AI : Verify login succeeded
        return this.isAuthenticated();
      }
    }
    
    return false;
  }

  /**
   * AI : Create a test user account (if registration is available)
   */
  async createTestUser(
    email: string = process.env.TEST_USER_EMAIL ?? 'playwright.test@example.com',
    password: string = process.env.TEST_USER_PASSWORD ?? 'TestPassword123!',
    username: string = 'PlaywrightTestUser'
  ) {
    await this.openAuthModal();
    
    const authModal = this.page.locator('[data-testid="auth-modal"]');
    if (await authModal.count() > 0) {
      // AI : Look for registration/signup toggle using data-testid
      const modeToggle = this.page.locator('[data-testid="auth-mode-toggle"]');
      if (await modeToggle.count() > 0) {
        await modeToggle.click();
        await this.page.waitForTimeout(500);
        
        // AI : Fill registration form using data-testid selectors
        const emailInput = this.page.locator('[data-testid="auth-email-input"]');
        const passwordInput = this.page.locator('[data-testid="auth-password-input"] input[type="password"]');
        const usernameInput = this.page.locator('[data-testid="auth-username-input"]');
        const registerButton = this.page.locator('[data-testid="auth-submit-button"]');
        
        if (await emailInput.count() > 0) {
          await emailInput.fill(email);
          await passwordInput.fill(password);
          if (await usernameInput.count() > 0) {
            await usernameInput.fill(username);
          }
          await registerButton.click();
          
          await this.page.waitForTimeout(3000);
          return this.isAuthenticated();
        }
      }
    }
    
    return false;
  }

  /**
   * AI : Logout current user
   */
  async logout() {
    const userMenu = this.page.locator('[data-testid="user-menu"]');
    if (await userMenu.count() > 0) {
      await userMenu.click();
      await this.page.waitForTimeout(500);
      
      const logoutButton = this.page.locator('[data-testid="sign-out-button"]');
      if (await logoutButton.count() > 0) {
        await logoutButton.click();
        await this.page.waitForTimeout(1000);
      }
    }
  }

  /**
   * AI : Setup authenticated state for tests
   * Uses browser storage to persist login across test runs
   */
  async setupAuthenticatedState() {
    // AI : Check if already authenticated
    if (await this.isAuthenticated()) {
      return true;
    }

    // AI : Try to restore previous session
    const storedAuth = await this.page.evaluate(() => {
      return localStorage.getItem('auth-token') ?? sessionStorage.getItem('auth-token');
    });

    if (storedAuth) {
      await this.page.reload();
      await this.page.waitForTimeout(2000);
      
      if (await this.isAuthenticated()) {
        return true;
      }
    }

    // AI : Attempt login with test credentials
    const loginSuccess = await this.login();
    if (loginSuccess) {
      return true;
    }

    // AI : If login fails, try creating a test user
    return this.createTestUser();
  }

  /**
   * AI : Setup unauthenticated state (logout if needed)
   */
  async setupUnauthenticatedState() {
    if (await this.isAuthenticated()) {
      await this.logout();
    }
  }
}