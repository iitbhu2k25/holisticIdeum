import SignInPage from "../shared/auth/SignInPage";

// User sign-in (navbar). Administrator accounts use /admin/login.
export default function LoginPage() {
  return (
    <SignInPage
      portal="user"
      title="Sign in"
      subtitle="Sign in to save your sessions and see your history"
      defaultNext="/holistic"
      note="Accounts are issued by the administrator. Contact them if you need access."
    />
  );
}
