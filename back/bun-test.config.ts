// AI : Bun test configuration for backend tests
export default {
  testTimeout: 30000, // 30 seconds for database operations
  beforeAll: async () => {
    // AI : Setup test database connection and migrations if needed
    // This would typically run migrations or ensure test database is ready
  },
  afterAll: async () => {
    // AI : Cleanup test database
    // Close connections, reset data, etc.
  }
}