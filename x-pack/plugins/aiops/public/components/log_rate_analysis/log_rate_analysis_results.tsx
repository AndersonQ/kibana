/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { FC } from 'react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { isEqual } from 'lodash';
import type * as estypes from '@elastic/elasticsearch/lib/api/typesWithBodyKey';

import {
  EuiButton,
  EuiButtonGroup,
  EuiCallOut,
  EuiEmptyPrompt,
  EuiFlexGroup,
  EuiFlexItem,
  EuiSpacer,
  EuiText,
} from '@elastic/eui';

import { reportPerformanceMetricEvent } from '@kbn/ebt-tools';
import { ProgressControls } from '@kbn/aiops-components';
import { cancelStream, startStream } from '@kbn/ml-response-stream/client';
import {
  clearAllRowState,
  useAppDispatch,
  useAppSelector,
} from '@kbn/aiops-log-rate-analysis/state';
import {
  getSwappedWindowParameters,
  LOG_RATE_ANALYSIS_TYPE,
  type LogRateAnalysisType,
} from '@kbn/aiops-log-rate-analysis';
import { i18n } from '@kbn/i18n';
import { FormattedMessage } from '@kbn/i18n-react';
import type { SignificantItem, SignificantItemGroup } from '@kbn/ml-agg-utils';
import { useStorage } from '@kbn/ml-local-storage';
import { AIOPS_ANALYSIS_RUN_ORIGIN } from '@kbn/aiops-common/constants';
import type { AiopsLogRateAnalysisSchema } from '@kbn/aiops-log-rate-analysis/api/schema';
import type { AiopsLogRateAnalysisSchemaSignificantItem } from '@kbn/aiops-log-rate-analysis/api/schema_v3';
import {
  setCurrentAnalysisType,
  setCurrentAnalysisWindowParameters,
  resetResults,
} from '@kbn/aiops-log-rate-analysis/api/stream_reducer';
import { fetchFieldCandidates } from '@kbn/aiops-log-rate-analysis/state/log_rate_analysis_field_candidates_slice';

import { useAiopsAppContext } from '../../hooks/use_aiops_app_context';
import { useDataSource } from '../../hooks/use_data_source';
import {
  commonColumns,
  significantItemColumns,
} from '../log_rate_analysis_results_table/use_columns';
import {
  AIOPS_LOG_RATE_ANALYSIS_RESULT_COLUMNS,
  type AiOpsKey,
  type AiOpsStorageMapped,
} from '../../types/storage';

import {
  getGroupTableItems,
  LogRateAnalysisResultsTable,
  LogRateAnalysisResultsGroupsTable,
} from '../log_rate_analysis_results_table';

import { ItemFilterPopover as FieldFilterPopover } from './item_filter_popover';
import { ItemFilterPopover as ColumnFilterPopover } from './item_filter_popover';
import { LogRateAnalysisInfoPopover } from './log_rate_analysis_info_popover';
import type { ColumnNames } from '../log_rate_analysis_results_table';

const groupResultsMessage = i18n.translate(
  'xpack.aiops.logRateAnalysis.resultsTable.groupedSwitchLabel.groupResults',
  {
    defaultMessage: 'Smart grouping',
  }
);
const groupResultsHelpMessage = i18n.translate(
  'xpack.aiops.logRateAnalysis.resultsTable.groupedSwitchLabel.groupResultsHelpMessage',
  {
    defaultMessage: 'Items which are unique to a group are marked by an asterisk (*).',
  }
);
const groupResultsOffMessage = i18n.translate(
  'xpack.aiops.logRateAnalysis.resultsTable.groupedSwitchLabel.groupResultsOff',
  {
    defaultMessage: 'Off',
  }
);
const groupResultsOnMessage = i18n.translate(
  'xpack.aiops.logRateAnalysis.resultsTable.groupedSwitchLabel.groupResultsOn',
  {
    defaultMessage: 'On',
  }
);
const resultsGroupedOffId = 'aiopsLogRateAnalysisGroupingOff';
const resultsGroupedOnId = 'aiopsLogRateAnalysisGroupingOn';
const fieldFilterHelpText = i18n.translate('xpack.aiops.logRateAnalysis.page.fieldFilterHelpText', {
  defaultMessage:
    'Deselect non-relevant fields to remove them from the analysis and click the Apply button to rerun the analysis.  Use the search bar to filter the list, then select/deselect multiple fields with the actions below.',
});
const columnsFilterHelpText = i18n.translate(
  'xpack.aiops.logRateAnalysis.page.columnsFilterHelpText',
  {
    defaultMessage: 'Configure visible columns.',
  }
);
const disabledFieldFilterApplyButtonTooltipContent = i18n.translate(
  'xpack.aiops.analysis.fieldSelectorNotEnoughFieldsSelected',
  {
    defaultMessage: 'Grouping requires at least 2 fields to be selected.',
  }
);
const disabledColumnFilterApplyButtonTooltipContent = i18n.translate(
  'xpack.aiops.analysis.columnSelectorNotEnoughColumnsSelected',
  {
    defaultMessage: 'At least one column must be selected.',
  }
);
const columnSearchAriaLabel = i18n.translate('xpack.aiops.analysis.columnSelectorAriaLabel', {
  defaultMessage: 'Filter columns',
});
const columnsButton = i18n.translate('xpack.aiops.logRateAnalysis.page.columnsFilterButtonLabel', {
  defaultMessage: 'Columns',
});
const fieldsButton = i18n.translate('xpack.aiops.analysis.fieldsButtonLabel', {
  defaultMessage: 'Fields',
});

/**
 * Interface for log rate analysis results data.
 */
export interface LogRateAnalysisResultsData {
  /** The type of analysis, whether it's a spike or dip */
  analysisType: LogRateAnalysisType;
  /** Statistically significant field/value items. */
  significantItems: SignificantItem[];
  /** Statistically significant groups of field/value items. */
  significantItemsGroups: SignificantItemGroup[];
}

/**
 * LogRateAnalysis props require a data view.
 */
interface LogRateAnalysisResultsProps {
  /** Callback for resetting the analysis */
  onReset: () => void;
  /** The search query to be applied to the analysis as a filter */
  searchQuery: estypes.QueryDslQueryContainer;
  /** Optional color override for the default bar color for charts */
  barColorOverride?: string;
  /** Optional color override for the highlighted bar color for charts */
  barHighlightColorOverride?: string;
}

export const LogRateAnalysisResults: FC<LogRateAnalysisResultsProps> = ({
  onReset,
  searchQuery,
  barColorOverride,
  barHighlightColorOverride,
}) => {
  const { analytics, http, embeddingOrigin } = useAiopsAppContext();
  const { dataView } = useDataSource();

  const dispatch = useAppDispatch();
  const {
    analysisType,
    earliest,
    latest,
    chartWindowParameters,
    documentStats: { sampleProbability },
    stickyHistogram,
    isBrushCleared,
  } = useAppSelector((s) => s.logRateAnalysis);
  const { isRunning, errors: streamErrors } = useAppSelector((s) => s.logRateAnalysisStream);
  const data = useAppSelector((s) => s.logRateAnalysisResults);
  const fieldCandidates = useAppSelector((s) => s.logRateAnalysisFieldCandidates);
  const { currentAnalysisWindowParameters } = data;

  // Store the performance metric's start time using a ref
  // to be able to track it across rerenders.
  const analysisStartTime = useRef<number | undefined>(window.performance.now());
  const abortCtrl = useRef(new AbortController());
  const previousSearchQuery = useRef(searchQuery);

  const [groupResults, setGroupResults] = useState<boolean>(false);
  const [overrides, setOverrides] = useState<AiopsLogRateAnalysisSchema['overrides'] | undefined>(
    undefined
  );
  const [shouldStart, setShouldStart] = useState(false);
  const [toggleIdSelected, setToggleIdSelected] = useState(resultsGroupedOffId);
  const [skippedColumns, setSkippedColumns] = useStorage<
    AiOpsKey,
    AiOpsStorageMapped<typeof AIOPS_LOG_RATE_ANALYSIS_RESULT_COLUMNS>
  >(AIOPS_LOG_RATE_ANALYSIS_RESULT_COLUMNS, ['p-value', 'Baseline rate', 'Deviation rate']);
  // null is used as the uninitialized state to identify the first load.
  const [skippedFields, setSkippedFields] = useState<string[] | null>(null);

  const onGroupResultsToggle = (optionId: string) => {
    setToggleIdSelected(optionId);
    setGroupResults(optionId === resultsGroupedOnId);

    // When toggling the group switch, clear all row selections
    dispatch(clearAllRowState());
  };

  const {
    fieldFilterUniqueItems,
    fieldFilterSkippedItems,
    keywordFieldCandidates,
    textFieldCandidates,
  } = fieldCandidates;
  const fieldFilterButtonDisabled =
    isRunning || fieldCandidates.isLoading || fieldFilterUniqueItems.length === 0;

  // Set skipped fields only on first load, otherwise we'd overwrite the user's selection.
  useEffect(() => {
    if (skippedFields === null && fieldFilterSkippedItems.length > 0)
      setSkippedFields(fieldFilterSkippedItems);
  }, [fieldFilterSkippedItems, skippedFields]);

  const onFieldsFilterChange = (skippedFieldsUpdate: string[]) => {
    dispatch(resetResults());
    setSkippedFields(skippedFieldsUpdate);
    setOverrides({
      loaded: 0,
      remainingKeywordFieldCandidates: keywordFieldCandidates.filter(
        (d) => !skippedFieldsUpdate.includes(d)
      ),
      remainingTextFieldCandidates: textFieldCandidates.filter(
        (d) => !skippedFieldsUpdate.includes(d)
      ),
      regroupOnly: false,
    });
    startHandler(true, false);
  };

  const onVisibleColumnsChange = (columns: ColumnNames[]) => {
    setSkippedColumns(columns);
  };

  function cancelHandler() {
    abortCtrl.current.abort();
    dispatch(cancelStream());
  }

  useEffect(() => {
    if (!isRunning) {
      const {
        loaded,
        remainingKeywordFieldCandidates,
        remainingTextFieldCandidates,
        groupsMissing,
      } = data;

      if (
        loaded < 1 &&
        ((Array.isArray(remainingKeywordFieldCandidates) &&
          remainingKeywordFieldCandidates.length > 0) ||
          (Array.isArray(remainingTextFieldCandidates) &&
            remainingTextFieldCandidates.length > 0) ||
          groupsMissing)
      ) {
        setOverrides({
          loaded,
          remainingKeywordFieldCandidates,
          remainingTextFieldCandidates,
          significantItems: data.significantItems as AiopsLogRateAnalysisSchemaSignificantItem[],
        });
      } else if (loaded > 0) {
        // Reset all overrides.
        setOverrides(undefined);

        // Track performance metric
        if (analysisStartTime.current !== undefined) {
          const analysisDuration = window.performance.now() - analysisStartTime.current;

          // Set this to undefined so reporting the metric gets triggered only once.
          analysisStartTime.current = undefined;

          reportPerformanceMetricEvent(analytics, {
            eventName: 'aiopsLogRateAnalysisCompleted',
            duration: analysisDuration,
          });
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRunning]);

  const errors = useMemo(() => [...streamErrors, ...data.errors], [streamErrors, data.errors]);

  // Start handler clears possibly hovered or pinned
  // significant items on analysis refresh.
  function startHandler(continueAnalysis = false, resetGroupButton = true) {
    if (!continueAnalysis) {
      dispatch(resetResults());
      setOverrides({
        remainingKeywordFieldCandidates: keywordFieldCandidates.filter(
          (d) => skippedFields === null || !skippedFields.includes(d)
        ),
        remainingTextFieldCandidates: textFieldCandidates.filter(
          (d) => skippedFields === null || !skippedFields.includes(d)
        ),
      });
    }

    // Reset grouping to false and clear all row selections when restarting the analysis.
    if (resetGroupButton) {
      setGroupResults(false);
      setToggleIdSelected(resultsGroupedOffId);
      dispatch(clearAllRowState());
    }

    dispatch(setCurrentAnalysisType(analysisType));
    dispatch(setCurrentAnalysisWindowParameters(chartWindowParameters));

    // We trigger hooks updates above so we cannot directly call `start()` here
    // because it would be run with stale arguments.
    setShouldStart(true);
  }

  const startParams = useMemo(() => {
    if (!chartWindowParameters || !earliest || !latest) {
      return undefined;
    }

    return {
      http,
      endpoint: '/internal/aiops/log_rate_analysis',
      apiVersion: '3',
      abortCtrl,
      body: {
        start: earliest,
        end: latest,
        searchQuery: JSON.stringify(searchQuery),
        // TODO Handle data view without time fields.
        timeFieldName: dataView.timeFieldName ?? '',
        index: dataView.getIndexPattern(),
        grouping: true,
        flushFix: true,
        // If analysis type is `spike`, pass on window parameters as is,
        // if it's `dip`, swap baseline and deviation.
        ...(analysisType === LOG_RATE_ANALYSIS_TYPE.SPIKE
          ? chartWindowParameters
          : getSwappedWindowParameters(chartWindowParameters)),
        overrides,
        sampleProbability,
      },
      headers: { [AIOPS_ANALYSIS_RUN_ORIGIN]: embeddingOrigin },
    };
  }, [
    analysisType,
    earliest,
    latest,
    http,
    searchQuery,
    dataView,
    chartWindowParameters,
    sampleProbability,
    overrides,
    embeddingOrigin,
  ]);

  useEffect(() => {
    if (shouldStart && startParams) {
      dispatch(startStream(startParams));
      setShouldStart(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldStart]);

  useEffect(() => {
    if (startParams) {
      dispatch(fetchFieldCandidates(startParams));
      dispatch(setCurrentAnalysisType(analysisType));
      dispatch(setCurrentAnalysisWindowParameters(chartWindowParameters));
      dispatch(startStream(startParams));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const groupTableItems = useMemo(
    () => getGroupTableItems(data.significantItemsGroups),
    [data.significantItemsGroups]
  );

  const searchQueryUpdated = useMemo(() => {
    let searchQueryChanged = false;
    if (
      !isRunning &&
      previousSearchQuery.current !== undefined &&
      !isEqual(previousSearchQuery.current, searchQuery)
    ) {
      searchQueryChanged = true;
    }
    previousSearchQuery.current = searchQuery;
    return searchQueryChanged;
  }, [searchQuery, isRunning]);

  const shouldRerunAnalysis = useMemo(
    () =>
      currentAnalysisWindowParameters !== undefined &&
      !isEqual(currentAnalysisWindowParameters, chartWindowParameters),
    [currentAnalysisWindowParameters, chartWindowParameters]
  );

  const showLogRateAnalysisResultsTable = data?.significantItems.length > 0;
  const groupItemCount = groupTableItems.reduce((p, c) => {
    return p + c.groupItemsSortedByUniqueness.length;
  }, 0);
  const foundGroups = groupTableItems.length > 0 && groupItemCount > 0;

  // Disable the grouping switch toggle only if no groups were found,
  // the toggle wasn't enabled already and no fields were selected to be skipped.
  const disabledGroupResultsSwitch = !foundGroups && !groupResults;

  const toggleButtons = [
    {
      id: resultsGroupedOffId,
      label: groupResultsOffMessage,
      'data-test-subj': 'aiopsLogRateAnalysisGroupSwitchOff',
    },
    {
      id: resultsGroupedOnId,
      label: groupResultsOnMessage,
      'data-test-subj': 'aiopsLogRateAnalysisGroupSwitchOn',
    },
  ];

  return (
    <div data-test-subj="aiopsLogRateAnalysisResults">
      <ProgressControls
        isBrushCleared={isBrushCleared}
        progress={data.loaded}
        progressMessage={data.loadingState ?? ''}
        isRunning={isRunning}
        onRefresh={() => startHandler(false)}
        onCancel={cancelHandler}
        onReset={onReset}
        shouldRerunAnalysis={shouldRerunAnalysis || searchQueryUpdated}
        analysisInfo={<LogRateAnalysisInfoPopover />}
      >
        <EuiFlexItem grow={false}>
          <EuiFlexGroup gutterSize="s" alignItems="center">
            <EuiFlexItem grow={false}>
              <EuiText size="xs">{groupResultsMessage}</EuiText>
            </EuiFlexItem>
            <EuiFlexItem grow={false}>
              <EuiButtonGroup
                data-test-subj={`aiopsLogRateAnalysisGroupSwitch${groupResults ? ' checked' : ''}`}
                buttonSize="s"
                isDisabled={disabledGroupResultsSwitch}
                legend="Smart grouping"
                options={toggleButtons}
                idSelected={toggleIdSelected}
                onChange={onGroupResultsToggle}
              />
            </EuiFlexItem>
          </EuiFlexGroup>
        </EuiFlexItem>
        <EuiFlexItem grow={false}>
          <FieldFilterPopover
            dataTestSubj="aiopsFieldFilterButton"
            disabled={fieldFilterButtonDisabled}
            disabledApplyButton={fieldFilterButtonDisabled}
            disabledApplyTooltipContent={disabledFieldFilterApplyButtonTooltipContent}
            helpText={fieldFilterHelpText}
            itemSearchAriaLabel={fieldsButton}
            popoverButtonTitle={fieldsButton}
            selectedItemLimit={1}
            uniqueItemNames={fieldFilterUniqueItems}
            initialSkippedItems={fieldFilterSkippedItems}
            onChange={onFieldsFilterChange}
          />
        </EuiFlexItem>
        <EuiFlexItem grow={false}>
          <ColumnFilterPopover
            dataTestSubj="aiopsColumnFilterButton"
            disabled={isRunning}
            disabledApplyButton={isRunning}
            disabledApplyTooltipContent={disabledColumnFilterApplyButtonTooltipContent}
            helpText={columnsFilterHelpText}
            itemSearchAriaLabel={columnSearchAriaLabel}
            initialSkippedItems={skippedColumns}
            popoverButtonTitle={columnsButton}
            selectedItemLimit={1}
            uniqueItemNames={
              (groupResults
                ? Object.values(commonColumns)
                : Object.values(significantItemColumns)) as string[]
            }
            onChange={onVisibleColumnsChange as (columns: string[]) => void}
          />
        </EuiFlexItem>
      </ProgressControls>

      {errors.length > 0 ? (
        <>
          <EuiSpacer size="xs" />
          <EuiCallOut
            title={i18n.translate('xpack.aiops.analysis.errorCallOutTitle', {
              defaultMessage:
                'The following {errorCount, plural, one {error} other {errors}} occurred running the analysis.',
              values: { errorCount: errors.length },
            })}
            color="warning"
            iconType="warning"
            size="s"
          >
            <EuiText size="s">
              {errors.length === 1 ? (
                <p>{errors[0]}</p>
              ) : (
                <ul>
                  {errors.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              )}
              {overrides !== undefined ? (
                <p>
                  <EuiButton
                    data-test-subj="aiopsLogRateAnalysisResultsTryToContinueAnalysisButton"
                    size="s"
                    onClick={() => startHandler(true)}
                  >
                    <FormattedMessage
                      id="xpack.aiops.logRateAnalysis.page.tryToContinueAnalysisButtonText"
                      defaultMessage="Try to continue analysis"
                    />
                  </EuiButton>
                </p>
              ) : null}
            </EuiText>
          </EuiCallOut>
          <EuiSpacer size="xs" />
        </>
      ) : null}
      {showLogRateAnalysisResultsTable && groupResults && foundGroups && (
        <>
          <EuiSpacer size="xs" />
          <EuiText size="xs">{groupResults ? groupResultsHelpMessage : undefined}</EuiText>
        </>
      )}
      <EuiSpacer size="s" />
      {!isRunning && !showLogRateAnalysisResultsTable && (
        <EuiEmptyPrompt
          data-test-subj="aiopsNoResultsFoundEmptyPrompt"
          title={
            <h2>
              <FormattedMessage
                id="xpack.aiops.logRateAnalysis.page.noResultsPromptTitle"
                defaultMessage="The analysis did not return any results."
              />
            </h2>
          }
          titleSize="xs"
          body={
            <p>
              <FormattedMessage
                id="xpack.aiops.logRateAnalysis.page.noResultsPromptBody"
                defaultMessage="Try to adjust the baseline and deviation time ranges and rerun the analysis. If you still get no results, there might be no statistically significant entities contributing to this deviation in log rate."
              />
            </p>
          }
        />
      )}
      {/* Using inline style as Eui Table overwrites overflow settings  */}
      <div
        style={
          stickyHistogram
            ? {
                height: '500px',
                overflowX: 'hidden',
                overflowY: 'auto',
                paddingTop: '20px',
              }
            : undefined
        }
      >
        {showLogRateAnalysisResultsTable && groupResults ? (
          <LogRateAnalysisResultsGroupsTable
            skippedColumns={skippedColumns}
            significantItems={data.significantItems}
            groupTableItems={groupTableItems}
            searchQuery={searchQuery}
            barColorOverride={barColorOverride}
            barHighlightColorOverride={barHighlightColorOverride}
          />
        ) : null}
        {showLogRateAnalysisResultsTable && !groupResults ? (
          <LogRateAnalysisResultsTable
            skippedColumns={skippedColumns}
            searchQuery={searchQuery}
            barColorOverride={barColorOverride}
            barHighlightColorOverride={barHighlightColorOverride}
          />
        ) : null}
      </div>
    </div>
  );
};
