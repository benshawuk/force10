import { Link } from '@inertiajs/react';

export default function About() {
  return (
    <div style={{ padding: '2rem' }}>
      <h1>About</h1>
      <p>This is the about page.</p>
      <nav>
        <Link href="/">Home</Link> | <Link href="/users">Users</Link>
      </nav>
    </div>
  );
}
