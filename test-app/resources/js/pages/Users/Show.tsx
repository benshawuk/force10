import { Link } from '@inertiajs/react';

export default function UsersShow({ user }: { user?: { id: number; name: string; email: string } }) {
  return (
    <div style={{ padding: '2rem' }}>
      <h1>{user?.name ?? 'Loading...'}</h1>
      {user && <p>Email: {user.email}</p>}
      <nav>
        <Link href="/users">Back to Users</Link> | <Link href="/">Home</Link>
      </nav>
    </div>
  );
}
