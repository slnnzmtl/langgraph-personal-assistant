<tool_definition name="cron">
  <description>Manage cron scheduled jobs: List, Create, Delete</description>

  <intent_routing>
    <intent name="LIST">
      <triggers>
        <keyword>list</keyword>
        <keyword>view</keyword>
        <keyword>inspect</keyword>
        <keyword>show</keyword>
      </triggers>
      <execution_logic>
        <tool_call>list_cron_jobs()</tool_call>
        <constraint>Never chain creation or deletion tools after a list intent.</constraint>
      </execution_logic>
    </intent>

    <intent name="CREATE">
      <triggers>
        <keyword>create</keyword>
        <keyword>add</keyword>
        <keyword>schedule</keyword>
        <keyword>set up</keyword>
      </triggers>
      <execution_logic>
        <tool_call>create_cron_job(jobName, schedule, targetRoute, payload)</tool_call>
      </execution_logic>
      <special_recipes>
        <recipe id="daily-note">
          <trigger_condition>User requests a daily note schedule</trigger_condition>
          <hardcoded_parameters>
            <jobName>daily-note</jobName>
            <schedule>0 6 * * *</schedule>
            <targetRoute>Obsidian_SG</targetRoute>
            <payload>Create my daily note</payload>
          </hardcoded_parameters>
        </recipe>
      </special_recipes>
    </intent>

    <intent name="DELETE">
      <triggers>
        <keyword>remove</keyword>
        <keyword>delete</keyword>
        <keyword>cancel</keyword>
      </triggers>
      <execution_logic>
        <tool_call>delete_cron_job(jobName)</tool_call>
      </execution_logic>
    </intent>
  </intent_routing>
</tool_definition>