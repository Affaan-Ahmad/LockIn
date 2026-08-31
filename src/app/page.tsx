/**
 * Development entry point.
 *
 * Plain links, no styling, no components. Its only job is to make the backend
 * reachable during development so the OAuth flow and the sync can be exercised
 * end to end. The real interface is a later milestone.
 */
export default function Page() {
  return (
    <main>
      <h1>LockIn — backend</h1>
      <p>No interface yet. These endpoints exist for development:</p>
      <ul>
        <li>
          <a href="/api/auth/google">Connect Google Classroom</a>
        </li>
        <li>
          <a href="/api/connection">GET /api/connection</a> — connection status
        </li>
        <li>
          <a href="/api/courses?refresh=true">GET /api/courses?refresh=true</a> — discover courses;
          <code>PUT /api/courses</code> chooses which to track
        </li>
        <li>
          <a href="/api/assignments/upcoming">GET /api/assignments/upcoming</a> — deadline feed
        </li>
        <li>
          <a href="/api/assignments/overdue">GET /api/assignments/overdue</a> — past due, not
          submitted
        </li>
        <li>
          <a href="/api/assignments/undated">GET /api/assignments/undated</a> — tracked coursework
          with no due date
        </li>
        <li>
          <code>POST /api/sync</code> — run a synchronisation
        </li>
        <li>
          <code>PUT /api/overrides</code> — mark an assignment relevant or not
        </li>
      </ul>
    </main>
  );
}
