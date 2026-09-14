import { CodeBlock } from "react-code-block";
import { themes } from "prism-react-renderer";

import { CopyButton } from "@/components/common/CopyButton";

export const EXCodeBlock = (props: {
  code: string;
  language: string;
  lines?: any;
}) => {
  return (
    <CodeBlock
      code={props.code}
      language={props.language}
      theme={themes.vsLight}
      lines={props.lines}
    >
      <div className="relative">
        <CodeBlock.Code className="overflow-x-auto rounded-xl border bg-muted/50 p-6 pr-14 text-sm">
          {({ isLineHighlighted }) => (
            <div
              className={`table-row ${
                // == null covers undefined too; lodash's isNil pulled in all of lodash.
                props.lines == null
                  ? ""
                  : isLineHighlighted
                  ? "bg-primary/10"
                  : "opacity-80"
              }`}
            >
              <div
                className={`table-cell select-none px-4 ${
                  isLineHighlighted ? "border-l-2 border-primary opacity-100" : "opacity-0"
                }`}
              />
              <CodeBlock.LineNumber className="table-cell select-none pr-4 text-right text-muted-foreground" />
              <CodeBlock.LineContent className="table-cell">
                <CodeBlock.Token />
              </CodeBlock.LineContent>
            </div>
          )}
        </CodeBlock.Code>
        <CopyButton
          value={props.code}
          label="Copy code"
          className="absolute right-2 top-2 size-8 bg-background"
        />
      </div>
    </CodeBlock>
  );
};
