import { CodeBlock } from "react-code-block";
import { themes } from "prism-react-renderer";
import { useCopyToClipboard } from "usehooks-ts";
import { ClipboardIcon, CheckIcon } from "@heroicons/react/24/outline";
import { isNil } from "lodash";

export const EXCodeBlock = (props: {
  code: string;
  language: string;
  lines?: any;
}) => {
  const [state, copyToClipboard] = useCopyToClipboard();
  const copyCode = () => {
    copyToClipboard(props.code);
  };

  return (
    <CodeBlock
      code={props.code}
      language={props.language}
      theme={themes.vsLight}
      lines={props.lines}
    >
      <div className="relative">
        <CodeBlock.Code className="bg-gray-50 border border-gray-200 p-6 rounded-xl border-[2.5px]">
          {({ isLineHighlighted }) => (
            <div
              className={`table-row ${
                isNil(props.lines)
                  ? ""
                  : isLineHighlighted
                  ? "bg-blue-500/10"
                  : "opacity-80"
              }`}
            >
              <div
                className={`table-cell px-4 text-emerald-400 select-none ${
                  isLineHighlighted ? "border-l-[2.5px] border-blue-500 opacity-100" : "opacity-0"
                }`}
              >
                
              </div>

              <CodeBlock.LineNumber
                className={`table-cell pr-4 text-sm text-gray-500 text-right select-none ${
                  !isNil(props.lines)
                    ? ""
                    : isLineHighlighted
                    ? "text-gray-300"
                    : "text-gray-500"
                }`}
              />
              <CodeBlock.LineContent className="table-cell">
                <CodeBlock.Token />
              </CodeBlock.LineContent>
            </div>
          )}
        </CodeBlock.Code>
        <button
          className="bg-gray-200/70 border border-gray-300/60 rounded-md p-2 absolute top-2 right-2 text-sm hover:text-blue-600"
          onClick={copyCode}
        >
          {state ? (
            <CheckIcon className="w-5" />
          ) : (
            <ClipboardIcon className="w-5" />
          )}
          {/* {state ? "Copied!" : "Copy code"} */}
        </button>
      </div>
    </CodeBlock>
  );
};
