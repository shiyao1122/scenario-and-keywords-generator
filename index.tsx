import React, { useState, useRef, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { GoogleGenAI, Type, Schema } from "@google/genai";

// Declare XLSX globally as it's loaded via CDN script in index.html
declare const XLSX: any;

// -- API & Model Constants --
const MODEL_NAME = "gemini-3-pro-preview";

// Default prompt for Step 1 (Scenarios & Keywords)
const DEFAULT_SCENARIO_PROMPT = `
You are an SEO expert. Based on the Topic and Outline above, specifically focus on **Part x** (or the section regarding product solutions).

Please generate:
1. **Scenarios:** High-level user situations for this section.
2. **Sub-scenarios:** VERY detailed, specific descriptions of the video problems or user needs (e.g., specific file types, specific visual defects like noise, blur, shake).
3. **Keywords:** High-volume search terms related to the entire topic.

Ensure the "subScenarios" provide enough detail for a writer to explain "how to use the product" to solve these specific problems.
`;

// Default prompt for Step 2 (Full Article)
const DEFAULT_ARTICLE_PROMPT = `
You are a senior SEO content creator at an overseas SaaS company specializing in "multimedia audio and video AI software". All products you are responsible for are under the "HitPaw" brand.

**Goal:**
Write a comprehensive, SEO-optimized blog post based strictly on the **Context** provided above (Topic, Outline, Scenarios, and Keywords).

**Execution Instructions:**

1.  **Utilize the Provided Data:**
    *   **Topic & Keywords:** Ensure the content stays on topic and keywords are placed naturally.
    *   **Outline:** Expand upon the provided "Outline" above. Do not create a new structure; fill the existing one with high-quality content.
    *   **Refined Scenarios & Sub-scenarios:** Incorporate these specific user scenarios into the body paragraphs to ensure the content addresses real user pain points.

2.  **SEO & Meta Information (Output this first):**
    *   **Meta Title:** 55-65 characters (Must include the main keyword).
    *   **Meta Description:** 120-160 characters (Click-worthy summary).
    *   **H1 Tag:** A primary heading matching the user intent.

3.  **Content Requirements:**
    *   **Word Count:** 1500-2500 words.
    *   **Opening:** The first paragraph (300-400 chars) must hook the reader and state the problem clearly.
    *   **Product Recommendation (HitPaw):**
        *   When the outline calls for a solution, recommend the relevant HitPaw product.
        *   **Steps:** Provide operational steps that are concise and clear (aim for brevity, e.g., ~20-40 words per step, but ensure clarity).
        *   **Context:** Describe product features specifically regarding the "Refined Scenarios".
    *   **FAQ:** Include exactly 4 questions relevant to the topic.

4.  **Format:**
    *   Use Markdown (H2, H3, bolding, lists).
    *   Tone: Professional, helpful, and authoritative.

**Action:**
Please ignore any previous instructions about writing an outline. Your task now is to **write the full article** based on the provided Outline and Context above. Start now.
`

interface ExcelRow {
  [key: string]: string | number | undefined;
}

const App = () => {
  // -- State: File & Data --
  const [file, setFile] = useState<File | null>(null);
  const [excelData, setExcelData] = useState<ExcelRow[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  // -- State: Step 1 (Scenarios) --
  const [scenarioPrompt, setScenarioPrompt] = useState(DEFAULT_SCENARIO_PROMPT);
  const [scenarioLoading, setScenarioLoading] = useState(false);
  const [scenarioResult, setScenarioResult] = useState<{
    scenarios: string;
    subScenarios: string;
    keywords: string;
  } | null>(null);

  // -- State: Step 2 (Article) --
  const [showArticleStep, setShowArticleStep] = useState(false);
  const [articlePrompt, setArticlePrompt] = useState(DEFAULT_ARTICLE_PROMPT);
  const [articleLoading, setArticleLoading] = useState(false);
  const [articleResult, setArticleResult] = useState<string | null>(null);

  // Helper to find key in row ignoring case/spacing
  const findKey = (row: ExcelRow, term: string) => {
    return Object.keys(row).find((k) => k.toLowerCase().includes(term.toLowerCase()));
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    setFile(selectedFile);
    setScenarioResult(null);
    setArticleResult(null);
    setShowArticleStep(false);
    setError(null);

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: "binary" });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        // Parse data
        const data = XLSX.utils.sheet_to_json(ws, { defval: "" }) as ExcelRow[];
        
        if (data.length > 0) {
          setExcelData(data);
          setHeaders(Object.keys(data[0]));
        } else {
          setError("Excel file appears to be empty.");
        }
      } catch (err) {
        console.error(err);
        setError("Failed to parse Excel file.");
      }
    };
    reader.readAsBinaryString(selectedFile);
  };

  // --- Step 1: Generate Scenarios ---
  const handleGenerateScenarios = async () => {
    if (!file || excelData.length === 0) return;

    setScenarioLoading(true);
    setError(null);
    setScenarioResult(null); // clear previous
    setArticleResult(null); // clear downstream
    setShowArticleStep(false);

    try {
      const firstRow = excelData[0];
      const topicKey = findKey(firstRow, "topic") || "Topic";
      const outlineKey = findKey(firstRow, "outline") || "Outline";
      
      const topicContent = firstRow[topicKey] || "N/A";
      const outlineContent = firstRow[outlineKey] || "N/A";

      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

      const responseSchema: Schema = {
        type: Type.OBJECT,
        properties: {
          scenarios: { type: Type.STRING, description: "Content for the Scenarios column" },
          subScenarios: { type: Type.STRING, description: "Content for the Sub-scenarios column" },
          keywords: { type: Type.STRING, description: "Content for the Keywords column" },
        },
        required: ["scenarios", "subScenarios", "keywords"],
      };

      const inputContent = `
        Context Data:
        Topic: ${topicContent}
        Outline: ${outlineContent}

        Instructions:
        ${scenarioPrompt}
      `;

      const response = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: inputContent,
        config: {
          responseMimeType: "application/json",
          responseSchema: responseSchema,
        },
      });

      const resultText = response.text;
      if (!resultText) throw new Error("No response from AI.");

      const resultJson = JSON.parse(resultText);

      setScenarioResult({
        scenarios: resultJson.scenarios,
        subScenarios: resultJson.subScenarios,
        keywords: resultJson.keywords,
      });

    } catch (err: any) {
      console.error(err);
      setError(err.message || "An error occurred during scenario generation.");
    } finally {
      setScenarioLoading(false);
    }
  };

  // --- Step 2: Generate Article ---
  const handleGenerateArticle = async () => {
    if (!scenarioResult || excelData.length === 0) return;

    setArticleLoading(true);
    setError(null);

    try {
      const firstRow = excelData[0];
      const topicKey = findKey(firstRow, "topic") || "Topic";
      const outlineKey = findKey(firstRow, "outline") || "Outline";
      
      const topicContent = firstRow[topicKey] || "N/A";
      const outlineContent = firstRow[outlineKey] || "N/A";

      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

      // We will ask for a JSON wrapper to keep it clean, but the content is the main thing
      const responseSchema: Schema = {
        type: Type.OBJECT,
        properties: {
          articleContent: { 
            type: Type.STRING, 
            description: "The complete article content in Markdown format. Do not use HTML tags." 
          },
        },
        required: ["articleContent"],
      };

      const inputContent = `
        You have the following context for an article:
        
        Topic: ${topicContent}
        Outline: ${outlineContent}
        
        Refined Scenarios: ${scenarioResult.scenarios}
        Refined Sub-scenarios: ${scenarioResult.subScenarios}
        Target Keywords: ${scenarioResult.keywords}

        Instructions:
        ${articlePrompt}

        Output Requirement:
        Provide the response purely in Markdown format. Do not use HTML tags (like <h1>, <p>, etc.), use Markdown syntax (like #, ##, normal text) instead.
      `;

      const response = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: inputContent,
        config: {
          responseMimeType: "application/json",
          responseSchema: responseSchema,
          // Increase token limit for long articles if needed, though default is usually high enough for Pro
        },
      });

      const resultText = response.text;
      if (!resultText) throw new Error("No response from AI.");
      const resultJson = JSON.parse(resultText);

      setArticleResult(resultJson.articleContent);

    } catch (err: any) {
      console.error(err);
      setError(err.message || "An error occurred during article generation.");
    } finally {
      setArticleLoading(false);
    }
  };

  const handleDownload = (includeArticle: boolean) => {
    if (!scenarioResult || excelData.length === 0) return;

    // Deep copy data
    const newData = JSON.parse(JSON.stringify(excelData));
    const firstRow = newData[0];

    // Map fields
    const scenariosKey = findKey(firstRow, "scenarios") || "Scenarios";
    const subScenariosKey = findKey(firstRow, "sub-scenarios") || findKey(firstRow, "sub_scenarios") || "Sub-scenarios";
    const keywordsKey = findKey(firstRow, "keywords") || "Keywords";
    const contentsKey = findKey(firstRow, "contents examples") || findKey(firstRow, "contentsexamples") || "Contents examples";

    // Update row 1 with Step 1 results
    firstRow[scenariosKey] = scenarioResult.scenarios;
    firstRow[subScenariosKey] = scenarioResult.subScenarios;
    firstRow[keywordsKey] = scenarioResult.keywords;

    // Update row 1 with Step 2 result (if requested and available)
    if (includeArticle && articleResult) {
      firstRow[contentsKey] = articleResult;
    }

    // Convert and download
    const ws = XLSX.utils.json_to_sheet(newData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Processed");
    const fileName = includeArticle ? "processed_with_article.xlsx" : "processed_scenarios.xlsx";
    XLSX.writeFile(wb, fileName);
  };

  return (
    <div className="min-h-screen p-8 max-w-5xl mx-auto pb-24">
      <header className="mb-8 text-center">
        <h1 className="text-3xl font-bold text-gray-800 mb-2">Scenario, Keyword & Examples Article Generator</h1>
        <p className="text-gray-500">Auto-fill Excel sheets using Gemini AI</p>
      </header>

      <div className="grid gap-6">
        {/* --- STEP 1: Upload --- */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
            <span className="bg-blue-100 text-blue-600 w-6 h-6 rounded-full flex items-center justify-center text-sm">1</span>
            Upload Excel
          </h2>
          <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:bg-gray-50 transition-colors relative">
            <input
              type="file"
              accept=".xlsx, .xls"
              onChange={handleFileUpload}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            />
            <div className="pointer-events-none">
              <svg className="mx-auto h-10 w-10 text-gray-400 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              {file ? (
                <p className="text-sm text-green-600 font-medium">{file.name}</p>
              ) : (
                <>
                  <p className="text-sm text-gray-600 font-medium">Click or drag Excel file here</p>
                  <p className="text-xs text-gray-400 mt-1">Supports .xlsx</p>
                </>
              )}
            </div>
          </div>
        </div>

        {/* --- STEP 2: Configure Scenarios --- */}
        <div className={`bg-white rounded-xl shadow-sm border border-gray-200 p-6 ${!file ? 'opacity-50 pointer-events-none' : ''}`}>
          <h2 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
             <span className="bg-blue-100 text-blue-600 w-6 h-6 rounded-full flex items-center justify-center text-sm">2</span>
             Generate Scenarios & Keywords
          </h2>
          
          <div className="mb-4">
             <label className="block text-sm font-medium text-gray-700 mb-1">Row 1 Context (Preview)</label>
             {excelData.length > 0 ? (
               <div className="bg-gray-50 p-3 rounded text-sm text-gray-600 border border-gray-200 max-h-60 overflow-y-auto">
                  <p className="whitespace-pre-wrap break-words mb-2"><strong>Topic:</strong> {String((excelData[0] as any)["Topic"] || (excelData[0] as any)[findKey(excelData[0], "topic") || ""] || "Not Found")}</p>
                  <p className="whitespace-pre-wrap break-words"><strong>Outline:</strong> {String((excelData[0] as any)["Outline"] || (excelData[0] as any)[findKey(excelData[0], "outline") || ""] || "Not Found")}</p>
               </div>
             ) : (
                <div className="bg-gray-50 p-3 rounded text-sm text-gray-400 border border-gray-200 italic">
                  Upload a file to see context
                </div>
             )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Prompt Instruction</label>
            <textarea
              value={scenarioPrompt}
              onChange={(e) => setScenarioPrompt(e.target.value)}
              className="w-full border border-gray-300 rounded-lg p-3 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none h-24"
              placeholder="Enter instructions for the AI..."
            />
          </div>

          <div className="mt-6 flex justify-end">
            <button
              onClick={handleGenerateScenarios}
              disabled={scenarioLoading}
              className={`px-6 py-2 rounded-lg text-white font-medium transition-all ${
                scenarioLoading 
                  ? 'bg-blue-400 cursor-wait' 
                  : 'bg-blue-600 hover:bg-blue-700 shadow-md hover:shadow-lg'
              }`}
            >
              {scenarioLoading ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin h-4 w-4 text-white" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Processing...
                </span>
              ) : (
                "Generate Scenarios"
              )}
            </button>
          </div>
        </div>

        {/* --- STEP 3: Scenario Results --- */}
        {scenarioResult && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 animate-fade-in-up">
            <h2 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
               <span className="bg-green-100 text-green-600 w-6 h-6 rounded-full flex items-center justify-center text-sm">3</span>
               Scenarios Generated
            </h2>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <div className="p-4 bg-gray-50 rounded-lg border border-gray-100">
                <h3 className="text-xs font-bold text-gray-500 uppercase mb-2">Scenarios</h3>
                <p className="text-sm text-gray-800 whitespace-pre-wrap">{scenarioResult.scenarios}</p>
              </div>
              <div className="p-4 bg-gray-50 rounded-lg border border-gray-100">
                <h3 className="text-xs font-bold text-gray-500 uppercase mb-2">Sub-scenarios</h3>
                <p className="text-sm text-gray-800 whitespace-pre-wrap">{scenarioResult.subScenarios}</p>
              </div>
              <div className="p-4 bg-gray-50 rounded-lg border border-gray-100">
                <h3 className="text-xs font-bold text-gray-500 uppercase mb-2">Keywords</h3>
                <p className="text-sm text-gray-800 whitespace-pre-wrap">{scenarioResult.keywords}</p>
              </div>
            </div>

            <div className="flex justify-end gap-3">
              <button
                onClick={() => handleDownload(false)}
                className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg font-medium hover:bg-gray-50 transition-all text-sm"
              >
                Download Excel (Step 1 Only)
              </button>
              {!showArticleStep && (
                <button
                  onClick={() => setShowArticleStep(true)}
                  className="px-6 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 shadow-md hover:shadow-lg transition-all"
                >
                  Next: Generate Article &rarr;
                </button>
              )}
            </div>
          </div>
        )}

        {/* --- STEP 4: Configure Article --- */}
        {showArticleStep && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 animate-fade-in-up">
            <h2 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
               <span className="bg-blue-100 text-blue-600 w-6 h-6 rounded-full flex items-center justify-center text-sm">4</span>
               Configure Article Generation
            </h2>

            <div className="mb-2">
               <p className="text-sm text-gray-600 mb-2">
                 The AI will use the <strong>Topic</strong>, <strong>Outline</strong>, and the <strong>Scenarios/Keywords</strong> generated above as context.
               </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Article Instructions</label>
              <textarea
                value={articlePrompt}
                onChange={(e) => setArticlePrompt(e.target.value)}
                className="w-full border border-gray-300 rounded-lg p-3 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none h-64"
                placeholder="Enter instructions for the Article..."
              />
            </div>

            <div className="mt-6 flex justify-end">
              <button
                onClick={handleGenerateArticle}
                disabled={articleLoading}
                className={`px-6 py-2 rounded-lg text-white font-medium transition-all ${
                  articleLoading 
                    ? 'bg-blue-400 cursor-wait' 
                    : 'bg-purple-600 hover:bg-purple-700 shadow-md hover:shadow-lg'
                }`}
              >
                {articleLoading ? (
                  <span className="flex items-center gap-2">
                    <svg className="animate-spin h-4 w-4 text-white" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Writing Article... (This may take a minute)
                  </span>
                ) : (
                  "Generate Full Article"
                )}
              </button>
            </div>
          </div>
        )}

        {/* --- STEP 5: Final Result --- */}
        {articleResult && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 animate-fade-in-up border-l-4 border-l-purple-500">
             <h2 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
               <span className="bg-purple-100 text-purple-600 w-6 h-6 rounded-full flex items-center justify-center text-sm">5</span>
               Article Generated!
            </h2>
            
            <div className="p-4 bg-gray-50 rounded-lg border border-gray-100 mb-6 max-h-96 overflow-y-auto">
              <div className="prose prose-sm max-w-none whitespace-pre-wrap">
                {articleResult}
              </div>
            </div>

            <div className="flex justify-center">
              <button
                onClick={() => handleDownload(true)}
                className="flex items-center gap-2 px-8 py-3 bg-purple-600 text-white rounded-lg font-medium hover:bg-purple-700 shadow-md hover:shadow-lg transition-all"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Download Final Excel (With Article)
              </button>
            </div>
          </div>
        )}

        {error && (
            <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm border border-red-200">
              {error}
            </div>
        )}

      </div>
    </div>
  );
};

const root = createRoot(document.getElementById("root")!);
root.render(<App />);
