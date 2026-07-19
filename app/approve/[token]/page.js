import ApprovalClient from "@/components/ApprovalClient";

export default async function ApprovePage({ params }) {
  const { token } = await params;
  return <ApprovalClient token={token} />;
}
