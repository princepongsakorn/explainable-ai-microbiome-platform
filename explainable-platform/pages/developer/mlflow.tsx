import Layout from "@/components/common/Layout";
export function Tokens() {
  return (
    <>
      <div className="p-8 bg-white h-full">
        <div className="flex flex-row justify-between items-center">
          <div className="text-xl font-medium">Personal access tokens</div>
        </div>
        <div
          style={{ height: "calc(100vh - 180px)" }}
          className="mt-4 pt-8 border-solid bg-white border-t-[1px] border-[#EAEAEA] w-full flex flex-row gap-6 overflow-hidden"
        ></div>
      </div>
    </>
  );
}

Tokens.Layout = Layout;
export default Tokens;
