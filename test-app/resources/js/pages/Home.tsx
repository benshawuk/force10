import { Link } from '@inertiajs/react';

export default function Home() {
  return (
    <div style={{ padding: '2rem' }}>
      <h1>Home</h1>
      <p>Welcome to Force10 test app.</p>
      <nav>
        <Link href="/about">About</Link> | <Link href="/users">Users</Link>
      </nav>
    </div>
  );
}
