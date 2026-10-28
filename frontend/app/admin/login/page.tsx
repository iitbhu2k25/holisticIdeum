import SignInPage from "../../shared/auth/SignInPage";

// Superuser sign-in, linked from the footer. Normal user accounts are refused here.
export default function AdminLoginPage() {
  return (
    <SignInPage
      portal="admin"
      title="Administrator sign in"
      subtitle="Data upload and management"
      defaultNext="/admin/datasets"
      note="For administrators only. Users sign in from the menu bar."
    />
  );
}
