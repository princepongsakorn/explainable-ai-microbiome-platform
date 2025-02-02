import Layout from "@/components/common/Layout";
import { ArrowRightIcon } from "@heroicons/react/outline";
import { ChangeEvent, useEffect, useState } from "react";
import Papa from "papaparse";
import {
  getModelsList,
  IPredictions,
  IPredictResponse,
  postModelPredict,
} from "./api/model";

const SummaryPlot = (props: { heatmap?: string; beeswarm?: string }) => {
  enum SummaryType {
    Heatmap = "Heatmap",
    Beeswarm = "Beeswarm",
  }
  const [selected, setSelected] = useState<SummaryType>(SummaryType.Beeswarm);

  return (
    <div className="overflow-hidden border-solid bg-white border-[1px] border-[#EAEAEA] rounded-md w-full mb-8">
      <div className="flex flex-row gap-4 items-center border-solid bg-white border-b-[1px] border-[#EAEAEA] w-full mb-4 p-4 justify-between">
        <div className="font-xl font-semibold text-black">Summary</div>
        <div className="inline-flex rounded-md shadow-xs" role="group">
          {Object.values(SummaryType).map((type, index) => (
            <button
              key={type}
              type="button"
              className={`inline-flex items-center px-4 py-2 text-sm font-medium border border-gray-200 hover:text-blue-700 ${
                index === 0 ? "rounded-s-lg" : "border-l-[0px] rounded-e-lg"
              } ${
                type === selected
                  ? "text-blue-700 bg-white"
                  : "text-gray-900 bg-[#F2F4F7]"
              }`}
              onClick={() => setSelected(type)}
            >
              {type}
            </button>
          ))}
        </div>
      </div>
      <div>
        <div className="ml-4 flex flex-row gap-4">
          <div className="flex flex-row gap-1 items-center">
            <div className="w-2 h-2 rounded-full bg-[#FF0051]" />
            <p>Positive</p>
          </div>
          <div className="flex flex-row gap-1 items-center">
            <div className="w-2 h-2 rounded-full bg-[#008BFB]" />
            <p>Negative</p>
          </div>
        </div>
        <img
          src={`data:image/png;base64,${
            selected === SummaryType.Heatmap ? props.heatmap : props.beeswarm
          }`}
        />
      </div>
    </div>
  );
};

const PredictionPlot = (props: { prediction: IPredictions }) => {
  return (
    <div className="overflow-hidden border-solid bg-white border-[1px] border-[#EAEAEA] rounded-md w-full mb-8">
      <div className="flex flex-row gap-4 items-center border-solid bg-white border-b-[1px] border-[#EAEAEA] w-full mb-4 p-4">
        <div className="font-xl font-semibold text-black">
          Subject {props.prediction.id}
        </div>
        <div className="h-[32px] border-solid border-l-[1px] border-[#EAEAEA] " />
        <div>
          <div className="font-semibold text-black">
            Prediction Probability: {(props.prediction.proba * 100).toFixed(1)}%{" "}
          </div>
          <div className="text-[#667085]">
            {props.prediction.class === 0
              ? "Unlikely to have condition"
              : "Likely to have condition"}
          </div>
        </div>
      </div>
      <div>
        <div className="ml-4 flex flex-row gap-4">
          <div className="flex flex-row gap-1 items-center">
            <div className="w-2 h-2 rounded-full bg-[#FF0051]" />
            <p>Positive</p>
          </div>
          <div className="flex flex-row gap-1 items-center">
            <div className="w-2 h-2 rounded-full bg-[#008BFB]" />
            <p>Negative</p>
          </div>
        </div>
        <img src={`data:image/png;base64,${props.prediction.plot.waterfall}`} />
      </div>
    </div>
  );
};
export function Home() {
  const [modelsName, setModelName] = useState<string[]>([]);
  const [process, setProcess] = useState<number>(0);
  const [csv, setCsv] = useState<any[]>();
  const [model, setModel] = useState<string>("");
  const [responseBody, setResponseBody] = useState<IPredictResponse>();
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const getModels = async () => {
      const data = await getModelsList();
      setModelName(data.models);
    };
    getModels();
  }, []);

  const handleFileSelect = (event: ChangeEvent<HTMLInputElement>) => {
    if (event?.target?.files?.length) {
      Papa.parse(event.target.files[0], {
        complete: async (result) => {
          setCsv(result?.data);
        },
      });
    }
  };

  const handleSubmit = async () => {
    if (csv && model) {
      try {
        const csvData = csv;
        const headers = csvData[0].slice(1);
        const data = csvData.slice(1);
        const numericData = data.map((row) =>
          row.slice(1).map((cell: any) => parseFloat(cell) || 0)
        );
        // const payload = {
        //   dataframe_split: {
        //     columns: headers,
        //     data: numericData,
        //   },
        // };
        const payload = {
          dataframe_split: {
            columns: [
              "Parabacteroides_unclassified",
              "Atopobium_parvulum",
              "Ruminococcus_obeum",
              "Acidaminococcus_unclassified",
              "Ruminococcus_gnavus",
              "Megasphaera_unclassified",
              "Eubacterium_rectale",
              "Bacteroides_vulgatus",
              "Clostridium_hathewayi",
              "Odoribacter_laneus",
              "Peptostreptococcus_unclassified",
              "Faecalibacterium_prausnitzii",
              "Bacillus_subtilis",
              "Alistipes_shahii",
              "Ruminococcus_torques",
              "Clostridium_leptum",
              "Lachnospiraceae_bacterium_2_1_58FAA",
              "Streptococcus_constellatus",
              "Desulfovibrio_desulfuricans",
              "Bacteroides_ovatus",
              "Burkholderiales_bacterium_1_1_47",
              "Acidaminococcus_fermentans",
              "Granulicatella_unclassified",
              "Escherichia_unclassified",
              "Bifidobacterium_adolescentis",
              "Megasphaera_elsdenii",
              "Clostridium_innocuum",
              "Megasphaera_micronuciformis",
              "Eubacterium_ventriosum",
              "Holdemania_filiformis",
              "Turicibacter_sanguinis",
              "Lachnospiraceae_bacterium_9_1_43BFAA",
              "Parabacteroides_goldsteinii",
              "Dorea_formicigenerans",
              "Streptococcus_intermedius",
              "Turicibacter_unclassified",
              "Actinomyces_odontolyticus",
              "Alistipes_putredinis",
              "Parasutterella_excrementihominis",
              "Lachnospiraceae_bacterium_8_1_57FAA",
              "Lactobacillus_salivarius",
              "Granulicatella_adiacens",
              "Roseburia_inulinivorans",
              "Lachnospiraceae_bacterium_3_1_46FAA",
              "Rothia_dentocariosa",
              "Bifidobacterium_dentium",
              "Megamonas_hypermegale",
              "Adlercreutzia_equolifaciens",
              "Alistipes_indistinctus",
              "Bacteroides_cellulosilyticus",
              "Odoribacter_splanchnicus",
              "Eubacterium_ramulus",
              "Eubacterium_cylindroides",
              "Roseburia_hominis",
              "Bacteroides_uniformis",
              "Clostridium_clostridioforme",
              "Alistipes_unclassified",
              "Streptococcus_mutans",
              "Fusobacterium_nucleatum",
              "Oscillibacter_unclassified",
              "Pseudoflavonifractor_capillosus",
              "Clostridium_scindens",
              "Gemella_unclassified",
              "Eggerthella_lenta",
              "Clostridium_asparagiforme",
              "Bacteroides_nordii",
              "Eggerthella_unclassified",
              "Coprobacter_fastidiosus",
              "Paraprevotella_unclassified",
              "Lachnospiraceae_bacterium_1_1_57FAA",
              "Coprobacillus_unclassified",
              "Blautia_hydrogenotrophica",
              "Erysipelotrichaceae_bacterium_6_1_45",
              "Flavonifractor_plautii",
              "Alistipes_senegalensis",
              "Clostridiaceae_bacterium_JC118",
              "Ruminococcus_lactaris",
              "Bifidobacterium_pseudocatenulatum",
              "Barnesiella_intestinihominis",
              "Lachnospiraceae_bacterium_5_1_63FAA",
              "Ruminococcus_bromii",
              "Bacteroides_finegoldii",
              "Gemella_morbillorum",
              "Bacteroides_fragilis",
              "Ruminococcus_callidus",
              "Odoribacter_unclassified",
              "Lachnospiraceae_bacterium_5_1_57FAA",
              "Eubacterium_sp_3_1_31",
              "Megamonas_unclassified",
              "Ruminococcus_sp_5_1_39BFAA",
              "Parvimonas_unclassified",
              "Enterobacter_cloacae",
              "Bilophila_unclassified",
              "Streptococcus_vestibularis",
              "Haemophilus_parainfluenzae",
              "Acidaminococcus_intestini",
              "Fusobacterium_mortiferum",
              "Rothia_mucilaginosa",
              "Clostridium_symbiosum",
              "Lachnospiraceae_bacterium_7_1_58FAA",
              "Bifidobacterium_breve",
              "Klebsiella_pneumoniae",
              "Bacteroides_coprocola",
              "Streptococcus_parasanguinis",
              "Klebsiella_oxytoca",
              "Alistipes_finegoldii",
              "Parabacteroides_merdae",
              "Megamonas_funiformis",
              "Akkermansia_muciniphila",
              "Paraprevotella_xylaniphila",
              "Bacteroides_salyersiae",
              "Erysipelotrichaceae_bacterium_2_2_44A",
              "Parabacteroides_johnsonii",
              "Eubacterium_hallii",
              "Veillonella_dispar",
              "Eubacterium_siraeum",
              "Bacteroides_faecis",
              "Bacteroides_dorei",
              "Gemella_sanguinis",
              "Dorea_unclassified",
              "Collinsella_aerofaciens",
              "Roseburia_intestinalis",
              "Subdoligranulum_sp_4_3_54A2FAA",
              "Streptococcus_thermophilus",
              "Bacteroides_plebeius",
              "Bifidobacterium_bifidum",
              "Clostridium_bolteae",
              "Clostridium_nexile",
              "Lachnospiraceae_bacterium_3_1_57FAA_CT1",
              "Bifidobacterium_longum",
              "Megamonas_rupellensis",
              "Streptococcus_infantis",
              "Mitsuokella_multacida",
              "Clostridium_bartlettii",
              "Dialister_invisus",
              "Prevotella_stercorea",
              "Bacteroides_massiliensis",
              "Erysipelotrichaceae_bacterium_21_3",
              "Gemella_haemolysans",
              "Subdoligranulum_unclassified",
              "Streptococcus_salivarius",
              "Paraprevotella_clara",
              "Streptococcus_anginosus",
              "Bacteroides_xylanisolvens",
              "Eubacterium_eligens",
              "Veillonella_parvula",
              "Citrobacter_freundii",
              "Bacteroides_stercoris",
              "Lachnospiraceae_bacterium_1_4_56FAA",
              "Bacteroidales_bacterium_ph8",
              "Coprococcus_comes",
              "Olsenella_unclassified",
              "Streptococcus_gordonii",
              "Peptostreptococcaceae_noname_unclassified",
              "Dorea_longicatena",
              "Bacteroides_caccae",
              "Anaerotruncus_colihominis",
              "Ruminococcaceae_bacterium_D16",
              "Streptococcus_mitis_oralis_pneumoniae",
              "Anaerotruncus_unclassified",
              "Catenibacterium_mitsuokai",
              "Clostridiales_bacterium_1_7_47FAA",
              "Anaerostipes_unclassified",
              "Sutterella_wadsworthensis",
              "Eubacterium_brachy",
              "Fusobacterium_ulcerans",
              "Bacteroides_clarus",
              "Desulfovibrio_piger",
              "Streptococcus_sanguinis",
              "Phascolarctobacterium_succinatutens",
              "Streptococcus_australis",
              "Veillonella_atypica",
              "Peptostreptococcus_stomatis",
              "Solobacterium_moorei",
              "Bilophila_wadsworthia",
              "Streptococcus_cristatus",
              "Bacteroides_thetaiotaomicron",
              "Alistipes_onderdonkii",
              "Klebsiella_unclassified",
              "Anaerostipes_hadrus",
              "Bacteroides_eggerthii",
              "Blautia_producta",
              "Prevotella_copri",
              "Clostridium_citroniae",
              "Veillonella_unclassified",
              "Parabacteroides_distasonis",
              "Eubacterium_biforme",
              "Methanobrevibacter_smithii",
              "Oribacterium_sinus",
              "Coprococcus_catus",
              "Bifidobacterium_animalis",
              "Holdemania_unclassified",
              "Clostridium_ramosum",
              "Gordonibacter_pamelaeae",
              "Parvimonas_micra",
              "Roseburia_unclassified",
              "Anaerostipes_caccae",
              "Escherichia_coli",
              "Brachyspira_unclassified",
              "Butyricicoccus_pullicaecorum",
              "Bacteroides_intestinalis",
            ],
            data: [
              [
                0.64201, 0.20636, 0.0682, 0, 6.49163, 0, 0, 4.8018, 0.04369, 0,
                0.05233, 6.16953, 0, 0.07447, 3.92331, 0, 0.00414, 0.03338, 0,
                0.41293, 0, 0, 0.10198, 0, 3.15068, 0, 0, 0.06737, 0.08144, 0,
                0.58521, 0, 0, 0.02139, 0.01803, 0.28681, 0.14662, 0, 0, 0, 0,
                0.0955, 0, 0.09164, 0.02277, 0.1291, 1.92649, 0, 0, 0.47523, 0,
                0, 0, 0.02273, 0.44265, 0.00591, 0.14023, 0, 0.01597, 0.34616,
                0, 0, 0, 0.02847, 0, 0, 0.25549, 0, 0, 0, 0.08363, 0, 0,
                0.09826, 0, 0, 0, 0, 0.91266, 0.16373, 0.51515, 2.12286,
                0.19551, 0.00841, 0, 0, 0, 0, 4.33994, 0, 0.25886, 0, 0.18088,
                0.03728, 2.96882, 0, 0, 0.17957, 0.0404, 0, 0, 0, 0, 0.79369, 0,
                0, 0.01886, 0.84391, 0, 0, 0.18844, 0, 0.60181, 1.7959, 0.02796,
                0, 0, 0.00161, 0.39684, 0, 0.38435, 8.23702, 0, 0, 0, 1.87483,
                0.16548, 0, 0, 4.21689, 0.00091, 0.39744, 0, 0.05355, 0, 0,
                4.21672, 0.08237, 0.0465, 0.13244, 1.14922, 0, 0.19157, 0.01635,
                0.39713, 0.13798, 0, 0, 0.08881, 0, 0, 0.01089, 0.08969,
                0.62879, 0.43057, 0, 0.01031, 0, 0.63411, 0.09463, 0, 0, 0,
                3.07631, 0.08377, 0.05025, 0, 0, 0.00931, 0.78143, 0.395,
                0.06471, 0.14657, 0.13667, 0.00158, 0.09601, 0.95273, 0.3809, 0,
                0.01845, 0, 0.00587, 0, 0.02586, 0.15533, 0, 0, 0, 0.07105, 0,
                0, 0.02525, 0.02283, 0, 0.03393, 0, 0, 5.17224, 0, 0, 0,
              ],
              [
                0.17526, 0, 0.35561, 0.37539, 0, 0, 7.45207, 2.11337, 0,
                0.00234, 0, 2.56056, 0.00523, 1.55377, 0, 0.0225, 0, 0, 0,
                0.24134, 0.13145, 0.07163, 0, 0, 0.11352, 0, 0, 0, 0.35436,
                0.00945, 0, 0, 0, 0.05562, 0, 0, 0, 5.78572, 0.18703, 0.0176, 0,
                0, 1.03967, 0.01123, 0, 0, 0, 0.02219, 0, 0.37147, 0.73085,
                0.02319, 0, 2.07869, 1.01688, 0, 0, 0, 0, 0.13012, 0.00583, 0,
                0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.00281, 0.00309, 0, 0, 0, 0,
                0.01655, 0.84607, 0, 0, 0, 0.27099, 0, 0, 0, 0, 0.15538, 0, 0,
                0.12157, 0, 0.04941, 0.00386, 0, 0, 0, 0.00971, 0, 23.58364, 0,
                0.10598, 0, 0, 0, 0, 0.00732, 0, 0, 0, 0, 0.03854, 0.00475,
                13.42953, 0, 1.45545, 0, 0, 0.10056, 0.55307, 0, 0.03428, 0,
                0.13481, 0, 0, 0, 0.47969, 0, 0.00274, 0, 0, 0, 0, 0, 0.00098,
                0, 2.70981, 0.12926, 0, 0, 0.86474, 2.79491, 1.26129, 0, 0, 0,
                0.57311, 0.18482, 0, 0, 0, 0.21644, 0, 0, 0.00933, 0, 0, 0, 0,
                0, 0, 0, 0, 0, 0, 0, 0, 0.06276, 0.02205, 0, 0, 0.0021, 0,
                0.89136, 0.12189, 0.5599, 0.01952, 0, 0, 0, 0.00195, 0.05828,
                2.0862, 0, 0, 0, 0.04621, 0, 0.00383, 0, 0.00193, 0, 0, 0, 0,
                0.00349, 0, 0,
              ],
              [
                0, 0, 0.08003, 0, 1.6024, 0, 0.59587, 0.2333, 0, 4.27013, 0,
                2.9222, 0, 1.82678, 0.18259, 0.00633, 0.4014, 0, 0.05958,
                0.19617, 0.01429, 0, 0, 0, 0.37833, 0, 0, 0, 0.11814, 0.01805,
                0, 0, 0, 0.09165, 0, 0, 0, 9.22261, 0.00641, 0.15226, 0, 0,
                0.12342, 0, 0, 0.03967, 0, 0.08159, 0.03231, 5.42552, 0.67794,
                0.08236, 0, 0.67546, 11.03704, 0, 0, 0, 0, 1.2984, 0.01201, 0,
                0, 0.00122, 0.02051, 0, 0.00931, 0.0389, 0, 0.07742, 0, 0, 0,
                0.01624, 0.08975, 0, 0.05108, 0.09393, 1.91958, 0.02782,
                10.5957, 0, 0, 0.12434, 0.03239, 0, 0, 0, 0, 0, 0, 0, 0.41668,
                0, 0, 0, 0, 0, 0, 0.03395, 0, 0, 0, 0, 0.10003, 0.10146,
                1.82557, 0, 5.80297, 0, 0.08294, 0.00276, 0.13837, 0.03715, 0,
                2.8522, 2.60424, 2.71372, 0, 0, 0.19391, 0.31378, 0, 0, 0, 0,
                0.03983, 0, 0.00488, 0.25843, 0, 0, 0, 0.00631, 0.01615, 0,
                2.1073, 0.00151, 0, 10.2214, 0, 0, 0, 0.28865, 0.86417, 0.00599,
                0, 4.57795, 0, 1.12568, 0, 0, 0, 0, 0.32703, 1.55812, 0,
                0.00975, 0, 0.01543, 0, 0.01175, 0, 0, 0, 0, 0.00035, 0, 0, 0,
                0, 0, 0, 0, 0.02822, 0, 0.22265, 3.20646, 0.00315, 0.05527, 0,
                0, 0, 0.00418, 0.02188, 0.3329, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
                0.00977, 0, 0, 0.25467,
              ],
            ],
          },
        };
        setResponseBody(undefined);
        setIsLoading(true);
        setProcess(0);

        const predictData = await postModelPredict(
          model,
          payload,
          (progressEvent) => {
            const percent = Math.round(
              ((progressEvent.loaded * 100) / (progressEvent.total ?? 0)) * 0.9
            );
            setProcess(percent);
          }
        );
        setProcess(100);
        setTimeout(() => {
          setIsLoading(false);
        }, 500);
        setResponseBody(predictData);
      } catch (err) {
        setIsLoading(false);
        setResponseBody(undefined);
      }
    }
  };

  return (
    <div className="p-8 justify-items-center">
      <div
        className={`overflow-hidden border-solid bg-white border-[1px] border-[#EAEAEA] max-w-4xl rounded-md w-4/5`}
      >
        <div className="w-full px-[34px] pt-[30px] pb-[24px]">
          <div className="flex flex-row gap-5 w-full">
            <div className="flex flex-1 gap-2">
              <div className="w-2/3">
                <input
                  className="block w-full text-sm text-gray-900 border border-gray-300 rounded-lg cursor-pointer bg-white focus:outline-none"
                  id="file_input"
                  type="file"
                  onChange={handleFileSelect}
                  disabled={isLoading}
                />
              </div>
              <div>
                <select
                  id="model-select"
                  className="bg-white border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5"
                  disabled={isLoading || modelsName.length === 0}
                  defaultValue={"none"}
                  onChange={(e) => setModel(e.target.value)}
                >
                  <option value="none">Choose a model</option>
                  {modelsName.map((model) => (
                    <option value={model}>{model}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <button
                type="button"
                className="text-gray-900 bg-white border border-gray-300 focus:outline-none hover:bg-gray-100 focus:ring-4 focus:ring-gray-100 font-medium rounded-lg text-sm px-5 py-2.5"
                disabled={isLoading}
                onClick={handleSubmit}
              >
                <ArrowRightIcon className="w-5" />
              </button>
            </div>
          </div>
          <p className="mt-2 text-sm text-gray-500" id="file_input_help">
            Only <span className="font-semibold text-black">.csv files</span>{" "}
            are supported. Please ensure your data is formatted correctly.
          </p>
        </div>
        <div
          style={{ width: `${process}%` }}
          className={`transition-width duration-300 ease-in-out bg-[#5448DE] h-[2px] ${
            isLoading ? "opacity-100" : "opacity-0"
          }`}
        />
      </div>
      <div className="max-w-4xl w-4/5">
        <div className="border-solid bg-white border-t-[1px] border-[#EAEAEA] w-full my-4" />
        {responseBody?.summary && (
          <SummaryPlot
            heatmap={responseBody?.summary.heatmap}
            beeswarm={responseBody?.summary.beeswarm}
          />
        )}
        {responseBody?.predictions.map((prediction) => (
          <PredictionPlot prediction={prediction} />
        ))}
      </div>
    </div>
  );
}

Home.Layout = Layout;
export default Home;
