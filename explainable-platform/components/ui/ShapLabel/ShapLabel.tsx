export const ShapLabel = () => {
  return (
    <div className="ml-4 flex flex-row gap-4">
      <div className="flex flex-row gap-1 items-center">
        <div className="w-2 h-2 rounded-full bg-[#FF0051]" />
        <p className="text-sm">Positive</p>
      </div>
      <div className="flex flex-row gap-1 items-center">
        <div className="w-2 h-2 rounded-full bg-[#008BFB]" />
        <p className="text-sm">Negative</p>
      </div>
    </div>
  );
};
